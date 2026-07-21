/**
 * AGENT_POLICY — enhetstester för dispatch-grinden (taskService.dispatchTask).
 *
 * Kärnregeln: en task får bara dispatchas från status 'assigned' eller 'created'.
 * En 'review'-task (väntar på godkännande) får ALDRIG köras — det är hela
 * SUGGEST→approve→dispatch-flödet. Testerna verifierar statusgrinden isolerat;
 * supabase och sidoeffekter är mockade.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        task: null as Record<string, unknown> | null,
        taskError: null as string | null,
    };
    return { state };
});

vi.mock('./supabase', () => ({
    supabase: {
        from() {
            return {
                select: () => ({
                    eq: () => ({
                        single: () =>
                            Promise.resolve({ data: h.state.task, error: h.state.taskError }),
                    }),
                }),
            };
        },
    },
}));

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('./comms', () => ({ executeCommsEmail: vi.fn() }));

import { dispatchTask } from './taskService';

beforeEach(() => {
    h.state.task = null;
    h.state.taskError = null;
});

describe('dispatchTask — statusgrind (AGENT_POLICY)', () => {
    it('nekar en task i status "review" (godkännande får inte kringgås)', async () => {
        h.state.task = { id: 't-1', status: 'review', executor: 'comms:email', customer_id: 'cust-1' };

        const res = await dispatchTask('t-1', 'worker-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/cannot dispatch/i);
        expect(res.error).toMatch(/review/);
    });

    it('nekar en redan slutförd task', async () => {
        h.state.task = { id: 't-2', status: 'completed', executor: 'local:echo', customer_id: 'cust-1' };

        const res = await dispatchTask('t-2', 'worker-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/cannot dispatch/i);
    });

    it('returnerar "Task not found" när tasken saknas', async () => {
        h.state.task = null;

        const res = await dispatchTask('saknas', 'worker-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/not found/i);
    });
});
