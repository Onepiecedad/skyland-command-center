/**
 * Ticket 20 — tester för checkClawRateLimits.
 *
 * Grindarna skyddar mot att claw-agenter översvämmar systemet: max samtidiga
 * körningar per kund, max körningar/timme per kund, och ett globalt tak/timme.
 * Icke-claw-executorer släpps alltid. Vid DB-fel ska grinden fail-open (tillåta)
 * så en rate-limit-hicka aldrig blockerar hela dispatchen. Standardgränser i
 * testmiljön: 3 concurrent / 20 per kund per h / 60 globalt per h.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const queues: Record<string, Array<unknown>> = { tasks: [], task_runs: [] };
    const flags = { throwOnTasks: false };
    return { queues, flags };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./supabase', () => {
    const DEFAULT = { data: null, error: null };
    const dequeue = (table: string) => h.queues[table]?.shift() ?? DEFAULT;
    return {
        supabase: {
            from(table: string) {
                const b: Record<string, unknown> = {};
                const pass = ['select', 'insert', 'update', 'delete', 'eq', 'in',
                    'gte', 'lte', 'like', 'order', 'limit', 'contains', 'neq', 'is'];
                for (const m of pass) b[m] = () => b;
                b.single = () => Promise.resolve(dequeue(table));
                b.maybeSingle = () => Promise.resolve(dequeue(table));
                b.then = (resolve: (v: unknown) => void) => {
                    if (table === 'tasks' && h.flags.throwOnTasks) throw new Error('DB nere');
                    resolve(dequeue(table));
                };
                return b;
            },
        },
    };
});

import { checkClawRateLimits } from './taskService';

beforeEach(() => {
    h.queues.tasks = [];
    h.queues.task_runs = [];
    h.flags.throwOnTasks = false;
});

describe('checkClawRateLimits', () => {
    it('släpper igenom icke-claw-executorer utan DB-anrop', async () => {
        const res = await checkClawRateLimits('cust-1', 'local:echo');
        expect(res.allowed).toBe(true);
    });

    it('tillåter claw under alla gränser', async () => {
        h.queues.tasks = [{ data: [], error: null }];             // 0 samtidiga
        h.queues.task_runs = [
            { count: 0, error: null },                            // per kund/h
            { count: 0, error: null },                            // globalt/h
        ];
        const res = await checkClawRateLimits('cust-1', 'claw:research');
        expect(res.allowed).toBe(true);
    });

    it('blockerar vid concurrent_limit (>= 3 samtidiga körningar)', async () => {
        h.queues.tasks = [{
            data: [
                { id: 't1', task_runs: [{ id: 'r1', status: 'running' }] },
                { id: 't2', task_runs: [{ id: 'r2', status: 'running' }] },
                { id: 't3', task_runs: [{ id: 'r3', status: 'running' }] },
            ],
            error: null,
        }];
        const res = await checkClawRateLimits('cust-1', 'claw:research');
        expect(res.allowed).toBe(false);
        expect(res.reason).toBe('concurrent_limit');
    });

    it('blockerar vid timgräns per kund (>= 20)', async () => {
        h.queues.tasks = [{ data: [], error: null }];             // inga samtidiga
        h.queues.task_runs = [{ count: 20, error: null }];        // per kund/h nått
        const res = await checkClawRateLimits('cust-1', 'claw:research');
        expect(res.allowed).toBe(false);
        expect(res.reason).toBe('hourly_limit');
        expect(res.details).toMatchObject({ customer_id: 'cust-1' });
    });

    it('blockerar vid global timgräns (>= 60) även utan customerId', async () => {
        // customerId=null → hoppar concurrent + per-kund, kollar bara globalt
        h.queues.task_runs = [{ count: 60, error: null }];
        const res = await checkClawRateLimits(null, 'claw:research');
        expect(res.allowed).toBe(false);
        expect(res.reason).toBe('hourly_limit');
        expect(res.details).toMatchObject({ scope: 'global' });
    });

    it('fail-open: DB-fel → tillåter dispatch (blockerar aldrig på en hicka)', async () => {
        h.flags.throwOnTasks = true;
        const res = await checkClawRateLimits('cust-1', 'claw:research');
        expect(res.allowed).toBe(true);
    });
});
