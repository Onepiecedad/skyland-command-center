/**
 * OpenAI Adapter Implementation
 * Ticket 21 - Alex AI Integration
 */

import OpenAI from 'openai';
import type { LLMAdapter, ChatInput, ChatOutput } from './adapter';
import { toProviderMessages, toProviderTools, fromProviderToolCalls } from './toolProtocol';
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
        const messages = toProviderMessages(input.systemPrompt, input.messages);
        const tools = toProviderTools(input.tools);

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages,
                tools,
                tool_choice: tools ? 'auto' : undefined
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
            logger.error('openai', 'Error calling OpenAI', { error: error instanceof Error ? error.message : error });
            throw error;
        }
    }
}
