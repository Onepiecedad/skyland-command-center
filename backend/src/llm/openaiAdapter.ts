/**
 * OpenAI Adapter Implementation
 * Ticket 21 - Alex AI Integration
 */

import OpenAI from 'openai';
import type { LLMAdapter, ChatInput, ChatOutput, ToolDefinition } from './adapter';
import { config } from '../config';
import { logger } from '../services/logger';

export class OpenAIAdapter implements LLMAdapter {
    private client: OpenAI;
    private model: string;

    constructor() {
        const apiKey = config.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY not configured (check LLM_PROVIDER)');
        }

        this.client = new OpenAI({ apiKey });
        this.model = config.LLM_MODEL;
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

            // Extract tool calls if present (only function type)
            const toolCalls = message.tool_calls
                ?.filter(tc => tc.type === 'function')
                .map(tc => ({
                    name: (tc as { type: 'function'; function: { name: string; arguments: string } }).function.name,
                    arguments: JSON.parse((tc as { type: 'function'; function: { name: string; arguments: string } }).function.arguments)
                }));

            return {
                text: message.content || '',
                toolCalls: toolCalls?.length ? toolCalls : undefined,
                usage: response.usage ? {
                    promptTokens: response.usage.prompt_tokens ?? 0,
                    completionTokens: response.usage.completion_tokens ?? 0,
                    totalTokens: response.usage.total_tokens ?? 0,
                } : undefined,
            };
        } catch (error) {
            logger.error('openai', 'Error calling OpenAI', { error: error instanceof Error ? error.message : error });
            throw error;
        }
    }
}
