/**
 * alexBrain — server-Alex chatpipeline som ÅTERANVÄNDBAR service.
 * Extraherad ur routes/chat.ts så att både textchatten (/api/v1/chat/chat)
 * och rösten (/api/v1/voice/tools → ask_alex-fallback) kör SAMMA hjärna:
 * samma systemprompt, samma ALEX_TOOLS (CRM, sekvenser, tasks), samma
 * messages-/activities-loggning.
 */

import crypto from 'crypto';
import { supabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';
import { logMessage, loadRecentMessages } from './messageService';
import { loadCustomersForPrompt } from './customerService';
import { getAdapter, ChatMessage } from '../llm/adapter';
import { logLLMCost } from './costService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { ALEX_TOOLS, executeToolCall } from '../llm/tools';

const MAX_TOOL_ROUNDS = 5;

export type AlexBrainErrorCode = 'adapter' | 'llm';

export class AlexBrainError extends Error {
    constructor(message: string, public code: AlexBrainErrorCode, public details?: string) {
        super(message);
        this.name = 'AlexBrainError';
    }
}

export interface AlexChatInput {
    message: string;
    channel?: string;
    conversation_id?: string;
    customer_id?: string | null;
}

export interface AlexActionTaken {
    action: string;
    table: string;
    details?: Record<string, unknown>;
}

export interface AlexChatResult {
    response: string;
    conversation_id: string;
    customer_id: string | null;
    actions_taken: AlexActionTaken[];
    proposed_actions: unknown[];
    tool_calls: string[];
}

/**
 * Kör hela Alex-pipelinen: logga inkommande, ladda kontext, LLM-loop med
 * verktyg (max MAX_TOOL_ROUNDS), logga utgående. Kastar AlexBrainError vid
 * adapter-/LLM-fel i första rundan; senare rundor degraderar mjukt.
 */
export async function runAlexChat(input: AlexChatInput): Promise<AlexChatResult> {
    const { message } = input;
    const channel = input.channel ?? 'chat';
    const conversation_id = input.conversation_id ?? crypto.randomUUID();
    const customerId = input.customer_id ?? null;

    const actions_taken: AlexActionTaken[] = [];
    const proposed_actions: unknown[] = [];
    const allToolCallNames: string[] = [];

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

    const systemPrompt = buildSystemPrompt(customers);

    const llmMessages: ChatMessage[] = [
        ...previousMessages.slice(0, -1), // Exclude the message we just logged
        { role: 'user', content: message }
    ];

    let adapter;
    try {
        adapter = getAdapter();
    } catch (adapterError) {
        logger.error('alexBrain', 'Failed to initialize LLM adapter', { error: adapterError instanceof Error ? adapterError.message : adapterError });
        throw new AlexBrainError(
            'LLM adapter not configured',
            'adapter',
            adapterError instanceof Error ? adapterError.message : 'Unknown error'
        );
    }

    // ================================================================
    // Multi-round tool calling loop
    // ================================================================
    const currentMessages = [...llmMessages];
    let responseText = '';
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
        round++;
        logger.info('alexBrain', `LLM round ${round}/${MAX_TOOL_ROUNDS}`);

        let llmResponse;
        try {
            llmResponse = await adapter.chat({
                systemPrompt,
                messages: currentMessages,
                tools: ALEX_TOOLS
            });

            logLLMCost({
                provider: config.LLM_PROVIDER,
                model: config.LLM_MODEL,
                agent: 'alex',
                usage: llmResponse.usage,
            });
        } catch (llmError) {
            logger.error('alexBrain', `LLM call failed (round ${round})`, { error: llmError instanceof Error ? llmError.message : llmError });
            if (round === 1) {
                throw new AlexBrainError(
                    'LLM call failed',
                    'llm',
                    llmError instanceof Error ? llmError.message : 'Unknown error'
                );
            }
            break; // On later rounds, use whatever we have so far
        }

        if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
            responseText = llmResponse.text;
            break;
        }

        logger.info('alexBrain', `Round ${round}: Processing ${llmResponse.toolCalls.length} tool calls`);
        const roundToolResults: Array<{ name: string; result: unknown }> = [];

        for (const toolCall of llmResponse.toolCalls) {
            logger.info('alexBrain', `Executing tool: ${toolCall.name}`);
            allToolCallNames.push(toolCall.name);
            const result = await executeToolCall(toolCall.name, toolCall.arguments);
            roundToolResults.push({ name: toolCall.name, result });

            if (toolCall.name === 'create_task_proposal' && result.success) {
                const taskData = result.data as { task_id: string; title: string };
                proposed_actions.push({
                    type: 'TASK_CREATED',
                    task_id: taskData.task_id,
                    title: taskData.title
                });

                await supabase.from('activities').insert({
                    customer_id: customerId,
                    agent: 'alex',
                    action: 'task_proposed',
                    event_type: 'task',
                    severity: 'info',
                    details: { conversation_id, task_id: taskData.task_id, title: taskData.title }
                });
                actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'task_proposed', task_id: taskData.task_id } });
            }
        }

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

        if (llmResponse.text) {
            responseText = llmResponse.text;
        }
    }

    if (round >= MAX_TOOL_ROUNDS && !responseText) {
        logger.warn('alexBrain', `Hit max tool rounds (${MAX_TOOL_ROUNDS}), generating final summary`);
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
            logger.error('alexBrain', 'Summary LLM call failed', { error: summaryError instanceof Error ? (summaryError as Error).message : summaryError });
        }
    }

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

    return {
        response: responseText,
        conversation_id,
        customer_id: customerId,
        actions_taken,
        proposed_actions,
        tool_calls: allToolCallNames
    };
}
