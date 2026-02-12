/**
 * Cost Logging Service
 * Logs LLM usage costs to Supabase after each chat call.
 * Silent on failure — logs warning but never crashes the request.
 */

import { supabase } from './supabase';
import { logger } from './logger';
import type { ChatOutput } from '../llm/adapter';

interface CostLogParams {
    provider: string;
    model: string;
    agent: string;
    usage?: ChatOutput['usage'];
    taskId?: string;
}

/**
 * Log an LLM call's cost to the costs table.
 * Designed to be fire-and-forget — never throws.
 */
export async function logLLMCost(params: CostLogParams): Promise<void> {
    try {
        const { provider, model, agent, usage, taskId } = params;

        // If no usage data, still log the call (with zero cost)
        const today = new Date().toISOString().split('T')[0];

        const { error } = await supabase.from('costs').insert({
            date: today,
            provider,
            model,
            agent,
            tokens_in: usage?.promptTokens ?? 0,
            tokens_out: usage?.completionTokens ?? 0,
            cost_usd: usage?.costUsd ?? 0,
            call_count: 1,
            task_id: taskId ?? null,
        });

        if (error) {
            logger.warn('cost', 'Failed to log cost', { error: error.message });
        }
    } catch (err) {
        logger.warn('cost', 'Unexpected error logging cost', { error: err instanceof Error ? err.message : err });
    }
}
