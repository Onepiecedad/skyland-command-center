import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { supabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';
import { chatRequestSchema } from '../schemas/chat';
import { logMessage, loadRecentMessages } from '../services/messageService';
import { loadCustomersForPrompt } from '../services/customerService';
import { getAdapter, ChatMessage } from '../llm/adapter';
import { logLLMCost } from '../services/costService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { ALEX_TOOLS, executeToolCall } from '../llm/tools';

const router = Router();

const MAX_TOOL_ROUNDS = 5;

// POST /chat - Alex chat endpoint
router.post('/chat', async (req: Request, res: Response) => {
    try {
        // Validate request
        const parsed = chatRequestSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { message, channel, customer_id: providedCustomerId } = parsed.data;
        const conversation_id = parsed.data.conversation_id ?? crypto.randomUUID();

        // Track actions for response
        const actions_taken: Array<{ action: string; table: string; details?: Record<string, unknown> }> = [];
        const proposed_actions: unknown[] = [];
        const allToolCallNames: string[] = [];

        // Use provided customer_id or null
        const customerId = providedCustomerId || null;

        // Log chat_received activity
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'alex',
            action: 'chat_received',
            event_type: 'chat',
            severity: 'info',
            details: { conversation_id, channel, message_length: message.length }
        });
        actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'chat_received' } });

        // Log inbound user message
        await logMessage({
            conversation_id,
            role: 'user',
            channel,
            direction: 'internal',
            content: message,
            customer_id: customerId
        });
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'user', conversation_id } });

        // Load context for LLM
        const [customers, previousMessages] = await Promise.all([
            loadCustomersForPrompt(),
            loadRecentMessages(conversation_id)
        ]);

        // Build system prompt with customer data
        const systemPrompt = buildSystemPrompt(customers);

        // Build messages for LLM (previous context + current message)
        const llmMessages: ChatMessage[] = [
            ...previousMessages.slice(0, -1), // Exclude the message we just logged (it's already the current one)
            { role: 'user', content: message }
        ];

        // Get LLM adapter
        let adapter;
        try {
            adapter = getAdapter();
        } catch (adapterError) {
            logger.error('chat', 'Failed to initialize LLM adapter', { error: adapterError instanceof Error ? adapterError.message : adapterError });
            return res.status(500).json({
                error: 'LLM adapter not configured',
                details: adapterError instanceof Error ? adapterError.message : 'Unknown error'
            });
        }

        // ================================================================
        // Multi-round tool calling loop (max MAX_TOOL_ROUNDS iterations)
        // ================================================================
        let currentMessages = [...llmMessages];
        let responseText = '';
        let round = 0;

        while (round < MAX_TOOL_ROUNDS) {
            round++;
            logger.info('chat', `LLM round ${round}/${MAX_TOOL_ROUNDS}`);

            let llmResponse;
            try {
                llmResponse = await adapter.chat({
                    systemPrompt,
                    messages: currentMessages,
                    tools: ALEX_TOOLS
                });

                // Log LLM cost (fire-and-forget)
                logLLMCost({
                    provider: config.LLM_PROVIDER,
                    model: config.LLM_MODEL,
                    agent: 'alex',
                    usage: llmResponse.usage,
                });
            } catch (llmError) {
                logger.error('chat', `LLM call failed (round ${round})`, { error: llmError instanceof Error ? llmError.message : llmError });
                if (round === 1) {
                    return res.status(500).json({
                        error: 'LLM call failed',
                        details: llmError instanceof Error ? llmError.message : 'Unknown error'
                    });
                }
                // On later rounds, use whatever we have so far
                break;
            }

            // No tool calls — we have the final text response
            if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
                responseText = llmResponse.text;
                break;
            }

            // Execute tool calls
            logger.info('chat', `Round ${round}: Processing ${llmResponse.toolCalls.length} tool calls`);
            const roundToolResults: Array<{ name: string; result: unknown }> = [];

            for (const toolCall of llmResponse.toolCalls) {
                logger.info('chat', `Executing tool: ${toolCall.name}`);
                allToolCallNames.push(toolCall.name);
                const result = await executeToolCall(toolCall.name, toolCall.arguments);
                roundToolResults.push({ name: toolCall.name, result });

                // If task was created, add to proposed_actions
                if (toolCall.name === 'create_task_proposal' && result.success) {
                    const taskData = result.data as { task_id: string; title: string };
                    proposed_actions.push({
                        type: 'TASK_CREATED',
                        task_id: taskData.task_id,
                        title: taskData.title
                    });

                    // Log task_proposed activity
                    await supabase.from('activities').insert({
                        customer_id: customerId,
                        agent: 'alex',
                        action: 'task_proposed',
                        event_type: 'task',
                        severity: 'info',
                        details: {
                            conversation_id,
                            task_id: taskData.task_id,
                            title: taskData.title
                        }
                    });
                    actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'task_proposed', task_id: taskData.task_id } });
                }
            }

            // Append assistant tool-call message + tool results to conversation
            currentMessages.push({
                role: 'assistant' as const,
                content: `Jag använder verktyg: ${roundToolResults.map(t => t.name).join(', ')}`
            });
            currentMessages.push({
                role: 'user' as const,
                content: `Verktygsresultat:\n${roundToolResults.map(tr =>
                    `${tr.name}: ${JSON.stringify(tr.result, null, 2)}`
                ).join('\n\n')}\n\nOm du behöver använda fler verktyg, gör det. Annars sammanfatta på ENKEL SVENSKA. Förklara för en person som INTE kan programmera. Inga JSON-objekt eller teknisk kod i svaret!`
            });

            // If LLM also returned text alongside tool calls, save as fallback
            if (llmResponse.text) {
                responseText = llmResponse.text;
            }
        }

        if (round >= MAX_TOOL_ROUNDS && !responseText) {
            logger.warn('chat', `Hit max tool rounds (${MAX_TOOL_ROUNDS}), generating final summary`);
            // Force a final summary without tools
            try {
                const summaryResponse = await adapter.chat({
                    systemPrompt,
                    messages: currentMessages,
                    tools: [] // No tools — force text response
                });
                logLLMCost({
                    provider: config.LLM_PROVIDER,
                    model: config.LLM_MODEL,
                    agent: 'alex',
                    usage: summaryResponse.usage,
                });
                if (summaryResponse.text) {
                    responseText = summaryResponse.text;
                }
            } catch (summaryError) {
                logger.error('chat', 'Summary LLM call failed', { error: summaryError instanceof Error ? (summaryError as Error).message : summaryError });
            }
        }

        // Fallback if no response
        if (!responseText) {
            responseText = 'Jag kunde inte generera ett svar. Vänligen försök igen eller omformulera din fråga.';
        }

        // Log outbound assistant message
        await logMessage({
            conversation_id,
            role: 'assistant',
            channel,
            direction: 'internal',
            content: responseText,
            customer_id: customerId,
            metadata: {
                tool_calls: allToolCallNames,
                tool_rounds: round
            }
        });
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'assistant', conversation_id } });

        // Log chat_responded activity
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'alex',
            action: 'chat_responded',
            event_type: 'chat',
            severity: 'info',
            autonomy_level: proposed_actions.length > 0 ? 'SUGGEST' : 'OBSERVE',
            details: {
                conversation_id,
                channel,
                response_length: responseText.length,
                tool_calls_count: allToolCallNames.length,
                tool_rounds: round,
                has_proposed_actions: proposed_actions.length > 0
            }
        });
        actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'chat_responded' } });

        // Return response
        return res.json({
            response: responseText,
            conversation_id,
            customer_id: customerId,
            actions_taken,
            proposed_actions,
            tool_calls: allToolCallNames
        });

    } catch (err) {
        logger.error('chat', 'Chat error', { error: err instanceof Error ? err.message : err });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /chat/history - fetch messages for a conversation
router.get('/chat/history', async (req: Request, res: Response) => {
    try {
        const { conversation_id } = req.query;

        if (!conversation_id || typeof conversation_id !== 'string') {
            return res.status(400).json({ error: 'conversation_id is required' });
        }

        // Validate UUID format
        const uuidSchema = z.string().uuid();
        const uuidParsed = uuidSchema.safeParse(conversation_id);

        if (!uuidParsed.success) {
            return res.status(400).json({ error: 'Invalid conversation_id format' });
        }

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('chat', 'Error fetching chat history', { error: error.message });
            return res.status(500).json({ error: error.message });
        }

        return res.json({ messages: data, conversation_id });

    } catch (err) {
        logger.error('chat', 'Chat history error', { error: err instanceof Error ? err.message : err });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
