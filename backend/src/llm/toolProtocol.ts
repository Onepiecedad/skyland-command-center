/**
 * Shared OpenAI-compatible tool-protocol mapping.
 *
 * All three adapters (OpenAI, DeepSeek, OpenRouter) speak the same wire format,
 * so the message/tool translation lives here instead of being copy-pasted three
 * times and drifting.
 *
 * The important invariant: a tool call's `id` survives the round trip.
 * The model emits tool_calls with ids; we execute them; we send each result back
 * as a `role: "tool"` message carrying the SAME id. Without that binding the
 * model cannot tell which of its requested operations actually ran, and will
 * happily report its plan as if it were the outcome.
 */

import type OpenAI from 'openai';
import type { ChatMessage, ToolCall, ToolDefinition } from './adapter';

/** Map our provider-agnostic messages onto the OpenAI chat format. */
export function toProviderMessages(
    systemPrompt: string,
    messages: ChatMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
        // Tool result. An orphan (no id) would be rejected by the API, so drop it
        // rather than poison the whole request.
        if (m.role === 'tool') {
            if (!m.toolCallId) continue;
            out.push({
                role: 'tool',
                tool_call_id: m.toolCallId,
                content: m.content,
            });
            continue;
        }

        // Assistant turn that requested tools — must be replayed WITH the tool_calls,
        // otherwise the following tool messages have nothing to attach to.
        if (m.role === 'assistant' && m.toolCalls?.length) {
            out.push({
                role: 'assistant',
                content: m.content ? m.content : null,
                tool_calls: m.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments ?? {}),
                    },
                })),
            });
            continue;
        }

        out.push({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
        });
    }

    return out;
}

/** Map our tool definitions onto the OpenAI function-tool format. */
export function toProviderTools(
    tools?: ToolDefinition[]
): OpenAI.Chat.ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map(tool => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}

/**
 * Read tool calls off a provider response, preserving ids.
 *
 * Malformed `arguments` JSON is degraded instead of throwing: the tool handler
 * then returns a normal validation error, which the model sees as a failed
 * result. Previously a single bad argument string threw inside .map() and took
 * down the entire request.
 */
export function fromProviderToolCalls(raw: unknown): ToolCall[] | undefined {
    if (!Array.isArray(raw)) return undefined;

    const calls: ToolCall[] = [];
    for (const entry of raw) {
        const tc = entry as {
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
        };
        if (tc.type !== 'function' || !tc.function?.name) continue;

        let args: Record<string, unknown> = {};
        if (tc.function.arguments) {
            try {
                const parsed = JSON.parse(tc.function.arguments);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    args = parsed as Record<string, unknown>;
                }
            } catch {
                args = { __malformed_arguments: tc.function.arguments };
            }
        }

        calls.push({
            id: tc.id || `call_${calls.length}`,
            name: tc.function.name,
            arguments: args,
        });
    }

    return calls.length ? calls : undefined;
}
