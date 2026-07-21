/**
 * Tester för logLLMCost — kostnadsloggningen som driver budget/kill-besluten.
 *
 * Kontrakt: bygg rätt kostnads-rad från usage, logga även när usage saknas
 * (nollor), och ALDRIG kasta — ett loggnings-fel får inte krascha chatt-svaret.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = { insertPayload: null as Record<string, unknown> | null, insertError: null as string | null, throwOnInsert: false };
    return { state };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./supabase', () => ({
    supabase: {
        from() {
            return {
                insert: (payload: Record<string, unknown>) => {
                    if (h.state.throwOnInsert) throw new Error('DB nere');
                    h.state.insertPayload = payload;
                    return Promise.resolve({ error: h.state.insertError });
                },
            };
        },
    },
}));

import { logLLMCost } from './costService';

beforeEach(() => {
    h.state.insertPayload = null;
    h.state.insertError = null;
    h.state.throwOnInsert = false;
});

describe('logLLMCost', () => {
    it('bygger en kostnads-rad från usage', async () => {
        await logLLMCost({
            provider: 'openrouter', model: 'openai/gpt-4o', agent: 'alex',
            usage: { promptTokens: 1500, completionTokens: 300, totalTokens: 1800, costUsd: 0.025 },
            taskId: 'task-1',
        });

        expect(h.state.insertPayload).toMatchObject({
            provider: 'openrouter', model: 'openai/gpt-4o', agent: 'alex',
            tokens_in: 1500, tokens_out: 300, cost_usd: 0.025, call_count: 1, task_id: 'task-1',
        });
        // datum sätts (YYYY-MM-DD)
        expect(String(h.state.insertPayload?.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('loggar med nollor när usage saknas', async () => {
        await logLLMCost({ provider: 'openai', model: 'gpt-4o', agent: 'alex' });
        expect(h.state.insertPayload).toMatchObject({
            tokens_in: 0, tokens_out: 0, cost_usd: 0, call_count: 1, task_id: null,
        });
    });

    it('kastar inte när insert returnerar fel (fire-and-forget)', async () => {
        h.state.insertError = 'insert kaputt';
        await expect(logLLMCost({ provider: 'openai', model: 'gpt-4o', agent: 'alex' })).resolves.toBeUndefined();
    });

    it('kastar inte när insert kastar (sväljer oväntat fel)', async () => {
        h.state.throwOnInsert = true;
        await expect(logLLMCost({ provider: 'openai', model: 'gpt-4o', agent: 'alex' })).resolves.toBeUndefined();
    });
});
