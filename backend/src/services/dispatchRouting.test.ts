/**
 * Ticket 19/20/30 — routing-tester för dispatchTask.
 *
 * dispatch.test.ts täcker statusgrinden (review nekas). Här testas den fulla
 * vägen EFTER grinden: run-skapande, status­övergångar (assigned→in_progress→
 * completed/failed) och att rätt executor-gren körs för local:echo, comms:email
 * och n8n. supabase mockas med en per-tabell-FIFO; ./comms mockas för att styra
 * utfallet av utskicks-grenen.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const queues: Record<string, Array<{ data: unknown; error: unknown }>> = {
        tasks: [], task_runs: [], activities: [],
    };
    const commsResult = { value: { success: true, output: { to: 'x@y.se' } } as { success: boolean; output?: unknown; error?: string } };
    return { queues, commsResult };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./comms', () => ({
    executeCommsEmail: vi.fn(async () => h.commsResult.value),
}));

vi.mock('./supabase', () => {
    const DEFAULT = { data: null, error: null };
    const dequeue = (table: string) => h.queues[table]?.shift() ?? DEFAULT;
    return {
        supabase: {
            from(table: string) {
                const b: Record<string, unknown> = {};
                const passthrough = ['select', 'insert', 'update', 'delete', 'eq', 'in',
                    'gte', 'lte', 'like', 'order', 'limit', 'contains', 'neq', 'is'];
                for (const m of passthrough) b[m] = () => b;
                b.single = () => Promise.resolve(dequeue(table));
                b.maybeSingle = () => Promise.resolve(dequeue(table));
                b.then = (resolve: (v: unknown) => void) => resolve(dequeue(table));
                return b;
            },
        },
    };
});

import { dispatchTask } from './taskService';
import { executeCommsEmail } from './comms';

function seedCommon(executor: string) {
    h.queues.tasks = [
        { data: { id: 't-1', status: 'assigned', executor, customer_id: 'cust-1', input: { foo: 1 } }, error: null },
        { data: { id: 't-1', status: 'in_progress', executor, customer_id: 'cust-1' }, error: null },
        { data: { id: 't-1', status: 'completed', executor, customer_id: 'cust-1' }, error: null },
    ];
    h.queues.task_runs = [
        { data: { run_number: 0 }, error: null },
        { data: { id: 'run-1', started_at: new Date().toISOString() }, error: null },
    ];
    h.queues.activities = [];
}

beforeEach(() => {
    h.commsResult.value = { success: true, output: { to: 'x@y.se' } };
    (executeCommsEmail as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('dispatchTask — executor-routing', () => {
    it('local:echo körs synkront och slutförs (assigned→completed)', async () => {
        seedCommon('local:echo');

        const res = await dispatchTask('t-1', 'worker-1');

        expect(res.success).toBe(true);
        expect(res.run.status).toBe('completed');
        // executeLocalEcho är ren och rör inte comms
        expect(executeCommsEmail).not.toHaveBeenCalled();
    });

    it('comms:email routar till utskicks-executorn och slutförs vid success', async () => {
        seedCommon('comms:email');
        h.commsResult.value = { success: true, output: { to: 'info@studio.se', provider_message_id: 'p-1' } };

        const res = await dispatchTask('t-1', 'worker-1');

        expect(executeCommsEmail).toHaveBeenCalledTimes(1);
        expect(res.success).toBe(true);
        expect(res.run.status).toBe('completed');
    });

    it('comms:email markerar tasken failed när utskicket misslyckas', async () => {
        seedCommon('comms:email');
        h.commsResult.value = { success: false, error: 'Utskick avstängda' };

        const res = await dispatchTask('t-1', 'worker-1');

        expect(executeCommsEmail).toHaveBeenCalledTimes(1);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/avstängda/i);
        expect(res.run.status).toBe('failed');
    });

    it('n8n: webhook som inte kan triggas → tasken markeras failed', async () => {
        // Blockera nätverket så executeN8nWebhook inte kan trigga (oavsett env).
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network blocked')));
        seedCommon('n8n:research');

        const res = await dispatchTask('t-1', 'worker-1');

        expect(res.success).toBe(false);
        expect(res.error).toBeTruthy();
        expect(res.run.status).toBe('failed');

        vi.unstubAllGlobals();
    });
});
