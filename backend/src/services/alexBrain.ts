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

/**
 * Appended to the system prompt.
 *
 * This used to be injected as a user message after every tool round, where it
 * did two harmful things: it pulled the model toward wrapping up instead of
 * continuing to work, and it forbade exactly the detail that would have exposed
 * a partial result. Reporting rules belong in the system prompt; the tool
 * results speak for themselves.
 */
const REPORTING_RULES = `
RAPPORTERINGSREGLER (gäller alltid):
- Påstå ALDRIG att något är utfört om det inte framgår av ett verktygsresultat.
  Ett verktygsresultat med "success": false betyder att ändringen INTE gjordes.
- Beskriv aldrig en plan i dåtid. Skriv inte "jag har uppdaterat" om du bara
  tänker göra det — utför det först, läs resultatet, rapportera sedan.
- Blev du ombedd att göra flera saker: redovisa varje sak för sig med utfall
  (gjord / misslyckad / saknar verktyg). Utelämna ingen punkt.
- Saknar du ett verktyg för något du ombetts göra, säg det rakt ut i stället
  för att beskriva det som klart.
- Skriv begripligt för en icke-tekniker, men hellre ärligt och tråkigt än
  trevligt och osant.`;

export type AlexBrainErrorCode = 'adapter' | 'llm';

/** Deterministic record of what actually executed, built from tool results — not from the model. */
export interface AlexToolExecution {
    tool: string;
    ok: boolean;
    error?: string;
}

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
    /** Ground truth per executed tool call. Use this, not the prose, to verify. */
    tool_executions: AlexToolExecution[];
    /** True when the loop ended on an error or ran out of rounds mid-work. */
    incomplete: boolean;
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

    const systemPrompt = buildSystemPrompt(customers) + '\n' + REPORTING_RULES;

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
    const currentMessages: ChatMessage[] = [...llmMessages];
    const toolExecutions: AlexToolExecution[] = [];
    let responseText = '';
    let round = 0;
    let incomplete = false;

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
            // Later rounds degrade, but the answer must not pretend to be complete.
            incomplete = true;
            break;
        }

        // No tool calls => this turn IS the final answer.
        if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
            responseText = llmResponse.text;
            break;
        }

        logger.info('alexBrain', `Round ${round}: Processing ${llmResponse.toolCalls.length} tool calls`);

        // Replay the assistant turn WITH its tool calls so the tool results below
        // have something to bind to. Any text the model emitted here is a plan,
        // not a report — it is deliberately never assigned to responseText.
        currentMessages.push({
            role: 'assistant',
            content: llmResponse.text || '',
            toolCalls: llmResponse.toolCalls,
        });

        for (const toolCall of llmResponse.toolCalls) {
            logger.info('alexBrain', `Executing tool: ${toolCall.name}`);
            allToolCallNames.push(toolCall.name);
            const result = await executeToolCall(toolCall.name, toolCall.arguments);

            toolExecutions.push({
                tool: toolCall.name,
                ok: Boolean(result.success),
                error: result.success ? undefined : String(result.error ?? 'okänt fel'),
            });

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

            // Real tool result, bound to the originating call id.
            currentMessages.push({
                role: 'tool',
                toolCallId: toolCall.id,
                content: JSON.stringify(result),
            });
        }

        if (round === MAX_TOOL_ROUNDS) {
            logger.warn('alexBrain', `Hit max tool rounds (${MAX_TOOL_ROUNDS}) with tool calls still pending`);
            incomplete = true;
        }
    }

    // The loop can exit with tool results but no final text (max rounds, or an
    // error on a later round). Force a text answer with tools disabled.
    if (!responseText) {
        logger.warn('alexBrain', 'No final text after tool loop — generating forced summary');
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

    // Deterministic receipt. Built from tool results, so it cannot over-report
    // no matter what the model wrote above it.
    responseText += buildExecutionReceipt(toolExecutions, incomplete);

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
            tool_rounds: round,
            tool_executions: toolExecutions,
            incomplete
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
            tool_calls_failed: toolExecutions.filter(t => !t.ok).length,
            tool_rounds: round,
            incomplete,
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
        tool_calls: allToolCallNames,
        tool_executions: toolExecutions,
        incomplete
    };
}

/**
 * Append a factual receipt of what ran. Derived entirely from tool results, so
 * if the prose above claims six changes and only four executed, the mismatch is
 * visible on screen instead of having to be discovered in the database later.
 */
function buildExecutionReceipt(executions: AlexToolExecution[], incomplete: boolean): string {
    if (executions.length === 0) {
        return incomplete
            ? '\n\n---\n⚠️ Körningen avbröts innan något verktyg hann köras. Inget är ändrat.'
            : '';
    }

    const ok = executions.filter(e => e.ok);
    const failed = executions.filter(e => !e.ok);

    const lines = ['\n\n---', '**Faktiskt utfört:**'];

    if (ok.length > 0) {
        const counts = new Map<string, number>();
        for (const e of ok) counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1);
        lines.push(...[...counts].map(([tool, n]) => `- ✅ ${tool}${n > 1 ? ` ×${n}` : ''}`));
    } else {
        lines.push('- Inga verktyg lyckades.');
    }

    if (failed.length > 0) {
        lines.push('**Misslyckades:**');
        lines.push(...failed.map(e => `- ❌ ${e.tool} — ${e.error}`));
    }

    if (incomplete) {
        lines.push('⚠️ Körningen nådde taket för verktygsrundor eller avbröts. Fler ändringar kan återstå.');
    }

    return lines.join('\n');
}
