/**
 * OpenRouter Adapter Implementation
 * Provides access to 500+ models via a single API key.
 * Uses OpenAI-compatible API at https://openrouter.ai/api/v1
 *
 * Model format: "provider/model" e.g. "openai/gpt-4o", "anthropic/claude-opus-4-6"
 * Variants:  ":free", ":nitro" (fast), ":floor" (cheap), ":thinking" (reasoning)
 */

import OpenAI from 'openai';
import type { LLMAdapter, ChatInput, ChatOutput } from './adapter';
import { toProviderMessages, toProviderTools, fromProviderToolCalls } from './toolProtocol';
import { config } from '../config';
import { logger } from '../services/logger';

export class OpenRouterAdapter implements LLMAdapter {
    private client: OpenAI;
    private model: string;

    constructor() {
        const apiKey = config.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY not configured (check LLM_PROVIDER)');
        }

        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': config.SCC_PUBLIC_BASE_URL || 'http://localhost:3001',
                'X-Title': 'Skyland Command Center',
            },
        });

        // Default to GPT-4o via OpenRouter; override with LLM_MODEL
        // Examples: "openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929", "deepseek/deepseek-chat"
        this.model = config.LLM_MODEL;
    }

    async chat(input: ChatInput): Promise<ChatOutput> {
        const messages = toProviderMessages(input.systemPrompt, input.messages);
        const tools = toProviderTools(input.tools);

        if (input.onDelta) {
            return this.chatStreaming(messages, tools, input.onDelta);
        }

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages,
                tools,
                tool_choice: tools ? 'auto' : undefined,
            });

            const choice = response.choices[0];
            const message = choice.message;

            const toolCalls = fromProviderToolCalls(message.tool_calls);

            return {
                text: message.content || '',
                toolCalls,
                usage: response.usage ? {
                    promptTokens: response.usage.prompt_tokens ?? 0,
                    completionTokens: response.usage.completion_tokens ?? 0,
                    totalTokens: response.usage.total_tokens ?? 0,
                } : undefined,
            };
        } catch (error) {
            logger.error('openrouter', 'Error calling OpenRouter', { error: error instanceof Error ? error.message : error });
            throw error;
        }
    }

    /**
     * Samma anrop, men med stream: true. Texten skickas vidare bit för bit så
     * att rösten kan börja läsa efter första meningen i stället för efter sista.
     * Verktygsanrop kommer också i bitar (namn först, argumenten tecken för
     * tecken) och sätts ihop per index innan de tolkas.
     */
    private async chatStreaming(
        messages: Parameters<OpenAI['chat']['completions']['create']>[0]['messages'],
        tools: ReturnType<typeof toProviderTools>,
        onDelta: (text: string) => void,
    ): Promise<ChatOutput> {
        try {
            const stream = await this.client.chat.completions.create({
                model: this.model,
                messages,
                tools,
                tool_choice: tools ? 'auto' : undefined,
                stream: true,
                stream_options: { include_usage: true },
            });

            let text = '';
            const partials = new Map<number, { id: string; name: string; args: string }>();
            let usage: ChatOutput['usage'];

            for await (const chunk of stream) {
                const delta = chunk.choices?.[0]?.delta as {
                    content?: string | null;
                    tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
                } | undefined;

                if (delta?.content) {
                    text += delta.content;
                    onDelta(delta.content);
                }

                for (const tc of delta?.tool_calls ?? []) {
                    const idx = tc.index ?? 0;
                    const cur = partials.get(idx) ?? { id: '', name: '', args: '' };
                    if (tc.id) cur.id = tc.id;
                    if (tc.function?.name) cur.name += tc.function.name;
                    if (tc.function?.arguments) cur.args += tc.function.arguments;
                    partials.set(idx, cur);
                }

                if (chunk.usage) {
                    usage = {
                        promptTokens: chunk.usage.prompt_tokens ?? 0,
                        completionTokens: chunk.usage.completion_tokens ?? 0,
                        totalTokens: chunk.usage.total_tokens ?? 0,
                    };
                }
            }

            const assembled = [...partials.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([, v]) => ({ id: v.id, type: 'function', function: { name: v.name, arguments: v.args } }));

            return { text, toolCalls: fromProviderToolCalls(assembled), usage };
        } catch (error) {
            logger.error('openrouter', 'Error streaming from OpenRouter', { error: error instanceof Error ? error.message : error });
            throw error;
        }
    }
}
