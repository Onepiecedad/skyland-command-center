/**
 * DeepSeek Adapter Implementation
 * Uses OpenAI-compatible API endpoint
 */

import OpenAI from 'openai';
import type { LLMAdapter, ChatInput, ChatOutput } from './adapter';

export class DeepSeekAdapter implements LLMAdapter {
    private client: OpenAI;
    private model: string;

    constructor() {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw new Error('DEEPSEEK_API_KEY environment variable is required');
        }

        // DeepSeek uses OpenAI-compatible API
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com'
        });
        this.model = process.env.LLM_MODEL || 'deepseek-chat';
    }

    async chat(input: ChatInput): Promise<ChatOutput> {
        // Build messages array with system prompt
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: input.systemPrompt },
            ...input.messages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
            }))
        ];

        // Convert tools to OpenAI format
        const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = input.tools?.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages,
                tools: tools?.length ? tools : undefined,
                tool_choice: tools?.length ? 'auto' : undefined
            });

            const choice = response.choices[0];
            const message = choice.message;

            // Extract tool calls if present
            const toolCalls = message.tool_calls
                ?.filter(tc => tc.type === 'function')
                .map(tc => ({
                    name: (tc as { type: 'function'; function: { name: string; arguments: string } }).function.name,
                    arguments: JSON.parse((tc as { type: 'function'; function: { name: string; arguments: string } }).function.arguments)
                }));

            return {
                text: message.content || '',
                toolCalls: toolCalls?.length ? toolCalls : undefined
            };
        } catch (error) {
            console.error('[deepseek-adapter] Error calling DeepSeek:', error);
            throw error;
        }
    }
}
