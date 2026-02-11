import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { supabase } from '../services/supabase';
import { chatRequestSchema } from '../schemas/chat';
import { logMessage, loadRecentMessages } from '../services/messageService';
import { loadCustomersForPrompt } from '../services/customerService';
import { getAdapter, ChatMessage } from '../llm/adapter';
import { logLLMCost } from '../services/costService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { MASTER_BRAIN_TOOLS, executeToolCall, formatToolResultForLLM } from '../llm/tools';

const router = Router();

// POST /chat - Master Brain chat endpoint
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

        // Use provided customer_id or null
        const customerId = providedCustomerId || null;

        // Log chat_received activity
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'master_brain',
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
            console.error('Failed to initialize LLM adapter:', adapterError);
            return res.status(500).json({
                error: 'LLM adapter not configured',
                details: adapterError instanceof Error ? adapterError.message : 'Unknown error'
            });
        }

        // Call LLM
        let llmResponse;
        try {
            llmResponse = await adapter.chat({
                systemPrompt,
                messages: llmMessages,
                tools: MASTER_BRAIN_TOOLS
            });

            // Log LLM cost (fire-and-forget)
            logLLMCost({
                provider: process.env.LLM_PROVIDER || 'openai',
                model: process.env.LLM_MODEL || 'gpt-4o',
                agent: 'alex',
                usage: llmResponse.usage,
            });
        } catch (llmError) {
            console.error('LLM call failed:', llmError);
            return res.status(500).json({
                error: 'LLM call failed',
                details: llmError instanceof Error ? llmError.message : 'Unknown error'
            });
        }

        // Process tool calls if present (single round, v1 scope)
        let responseText = llmResponse.text;
        const toolResults: Array<{ name: string; result: unknown }> = [];

        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
            console.log(`[chat] Processing ${llmResponse.toolCalls.length} tool calls`);

            for (const toolCall of llmResponse.toolCalls) {
                console.log(`[chat] Executing tool: ${toolCall.name}`);
                const result = await executeToolCall(toolCall.name, toolCall.arguments);
                toolResults.push({ name: toolCall.name, result });

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
                        agent: 'master_brain',
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

                // Append formatted tool result to response if LLM didn't provide text
                if (!responseText) {
                    responseText = formatToolResultForLLM(toolCall.name, result);
                }
            }

            // CRITICAL: Send tool results back to LLM for a natural language response
            if (toolResults.length > 0) {
                console.log(`[chat] Sending ${toolResults.length} tool results back to LLM for natural response`);

                // Build tool result messages
                const toolResultMessages: ChatMessage[] = [
                    ...llmMessages,
                    {
                        role: 'assistant' as const,
                        content: `Jag har hämtat data med verktyg: ${toolResults.map(t => t.name).join(', ')}`
                    },
                    {
                        role: 'user' as const,
                        content: `Verktygsdata:\n${toolResults.map(tr =>
                            `${tr.name}: ${JSON.stringify(tr.result, null, 2)}`
                        ).join('\n\n')}\n\nSammanfatta detta på ENKEL SVENSKA. Förklara för en person som INTE kan programmera vad som hänt och varför. Inga JSON-objekt eller teknisk kod i svaret!`
                    }
                ];

                try {
                    const followUpResponse = await adapter.chat({
                        systemPrompt,
                        messages: toolResultMessages,
                        tools: [] // No tools in follow-up, just generate text
                    });

                    // Log follow-up LLM cost (fire-and-forget)
                    logLLMCost({
                        provider: process.env.LLM_PROVIDER || 'openai',
                        model: process.env.LLM_MODEL || 'gpt-4o',
                        agent: 'alex',
                        usage: followUpResponse.usage,
                    });

                    if (followUpResponse.text) {
                        responseText = followUpResponse.text;
                    }
                } catch (followUpError) {
                    console.error('Follow-up LLM call failed:', followUpError);
                    // Keep the formatted tool result as fallback
                }
            }

            // If LLM provided text AND we have tool results, keep LLM text
            if (llmResponse.text && toolResults.length > 0) {
                responseText = llmResponse.text;
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
                tool_calls: llmResponse.toolCalls?.map(tc => tc.name) || [],
                tool_results: toolResults.length
            }
        });
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'assistant', conversation_id } });

        // Log chat_responded activity
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'master_brain',
            action: 'chat_responded',
            event_type: 'chat',
            severity: 'info',
            autonomy_level: proposed_actions.length > 0 ? 'SUGGEST' : 'OBSERVE',
            details: {
                conversation_id,
                channel,
                response_length: responseText.length,
                tool_calls_count: llmResponse.toolCalls?.length || 0,
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
            tool_calls: llmResponse.toolCalls?.map(tc => tc.name) || []
        });

    } catch (err) {
        console.error('Chat error:', err);
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
            console.error('Error fetching chat history:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ messages: data, conversation_id });

    } catch (err) {
        console.error('Chat history error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
