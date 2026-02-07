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

export class OpenRouterAdapter implements LLMAdapter {
    private client: OpenAI;
    private model: string;

    constructor() {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY environment variable is required');
        }

        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': process.env.SCC_PUBLIC_BASE_URL || 'http://localhost:3001',
                'X-Title': 'Skyland Command Center',
            },
        });

        // Default to GPT-4o via OpenRouter; override with LLM_MODEL
        // Examples: "openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929", "deepseek/deepseek-chat"
        this.model = process.env.LLM_MODEL || 'openai/gpt-4o';
    }

    async chat(input: ChatInput): Promise<ChatOutput> {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: input.systemPrompt },
            ...input.messages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
        ];

        const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = input.tools?.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages,
                tools: tools?.length ? tools : undefined,
                tool_choice: tools?.length ? 'auto' : undefined,
            });

            const choice = response.choices[0];
            const message = choice.message;

            const toolCalls = message.tool_calls
                ?.filter(tc => tc.type === 'function')
                .map(tc => ({
                    name: (tc as { type: 'function'; function: { name: string; arguments: string } }).function.name,
                    arguments: JSON.parse((tc as { type: 'function'; function: { name: string; arguments: string } }).function.arguments),
                }));

            return {
                text: message.content || '',
                toolCalls: toolCalls?.length ? toolCalls : undefined,
            };
        } catch (error) {
            console.error('[openrouter-adapter] Error calling OpenRouter:', error);
            throw error;
        }
    }
}
