/**
 * LLM Adapter Layer - Provider-agnostic interface for LLM interactions
 * Ticket 21 - Alex AI Integration
 */

// Tool definition for function calling
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}

// Tool call result from LLM
export interface ToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

// Chat message format
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// LLM chat input
export interface ChatInput {
    systemPrompt: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
}

// LLM chat output
export interface ChatOutput {
    text: string;
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUsd?: number;  // Available from OpenRouter via x-openrouter-cost
    };
}

// Provider-agnostic LLM adapter interface
export interface LLMAdapter {
    chat(input: ChatInput): Promise<ChatOutput>;
}

// Supported providers
export type LLMProvider = 'openai' | 'deepseek' | 'openrouter' | 'anthropic';

// Factory function to create adapter based on provider
export function createAdapter(provider: LLMProvider): LLMAdapter {
    switch (provider) {
        case 'openai':
            // Dynamic import to avoid loading unused providers
            const { OpenAIAdapter } = require('./openaiAdapter');
            return new OpenAIAdapter();
        case 'deepseek':
            const { DeepSeekAdapter } = require('./deepseekAdapter');
            return new DeepSeekAdapter();
        case 'openrouter':
            const { OpenRouterAdapter } = require('./openrouterAdapter');
            return new OpenRouterAdapter();
        case 'anthropic':
            throw new Error('Anthropic adapter not yet implemented');
        default:
            throw new Error(`Unknown LLM provider: ${provider}`);
    }
}

// Get adapter from environment
export function getAdapter(): LLMAdapter {
    // config.ts guarantees LLM_PROVIDER is valid at startup
    const { config } = require('../config');
    const provider = config.LLM_PROVIDER as LLMProvider;
    return createAdapter(provider);
}
