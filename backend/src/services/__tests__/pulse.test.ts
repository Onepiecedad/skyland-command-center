/**
 * Pulsen får inte bli en ström. Testerna handlar därför mindre om att den
 * hittar saker, och mer om att den TIGER: ingen historik vid start, inget
 * upprepat larm, ingen rad när läget är oförändrat.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    leads: [] as Record<string, unknown>[],
    credits: { remaining_usd: 42, spent_24h_usd: 0, spent_7d_usd: 0, fetched_at: '' },
    health: [] as { name: string; status: string }[],
    poller: { stale: false, secondsSince: 3, lastWorker: 'alex' },
    emitSystemEvent: vi.fn(),
}));

vi.mock('../supabase', () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'gte']) b[m] = () => b;
    b.limit = () => Promise.resolve({ data: h.leads, error: null });
    return { supabase: { from: () => b } };
});
vi.mock('../../routes/eventStream', () => ({ emitSystemEvent: h.emitSystemEvent }));
vi.mock('../../routes/integrations', () => ({ openRouterCredits: async () => h.credits }));
vi.mock('../integrationHealth', () => ({ checkAll: async () => h.health }));
vi.mock('../pollerWatchdog', () => ({ pollerStatus: () => h.poller }));

import { pulseOnce, stopPulse } from '../pulse';

const lead = (id: string, at: string, name = 'Juanita') =>
    ({ id, name, country: 'ZA', group_size: 5, channel: 'whatsapp', created_at: at });

beforeEach(() => {
    stopPulse();
    h.leads = [];
    h.credits = { remaining_usd: 42, spent_24h_usd: 0, spent_7d_usd: 0, fetched_at: '' };
    h.health = [];
    h.poller = { stale: false, secondsSince: 3, lastWorker: 'alex' };
    h.emitSystemEvent.mockReset();
});

describe('pulse', () => {
    it('säger ingenting om historik vid första ronden', async () => {
        h.leads = [lead('a', '2026-09-09T18:00:00Z')];
        expect(await pulseOnce()).toEqual([]);
        expect(h.emitSystemEvent).not.toHaveBeenCalled();
    });

    it('larmar om ett lead som kommit sedan förra ronden', async () => {
        h.leads = [lead('a', '2026-09-09T18:00:00Z')];
        await pulseOnce();
        h.leads = [lead('b', '2026-09-09T18:05:00Z', 'Sandra'), lead('a', '2026-09-09T18:00:00Z')];
        const notes = await pulseOnce();
        expect(notes).toHaveLength(1);
        expect(notes[0].text).toContain('Sandra');
        expect(notes[0].urgent).toBe(true);
        expect(h.emitSystemEvent).toHaveBeenCalledWith(
            'ui_action',
            expect.objectContaining({ action: 'note', source: 'pulse', kind: 'ce_lead', speak: true }),
            'alex',
        );
    });

    it('upprepar inte samma lead', async () => {
        h.leads = [lead('a', '2026-09-09T18:00:00Z')];
        await pulseOnce();
        h.leads = [lead('b', '2026-09-09T18:05:00Z'), lead('a', '2026-09-09T18:00:00Z')];
        await pulseOnce();
        expect(await pulseOnce()).toEqual([]);
    });

    it('varnar för lågt saldo en gång, inte varje rond', async () => {
        h.credits = { remaining_usd: 1.4, spent_24h_usd: 0, spent_7d_usd: 0, fetched_at: '' };
        const first = await pulseOnce();
        expect(first.find(n => n.kind === 'credits')?.urgent).toBe(true);
        expect((await pulseOnce()).find(n => n.kind === 'credits')).toBeUndefined();
    });

    it('tiger om saldot är gott', async () => {
        h.credits = { remaining_usd: 12, spent_24h_usd: 0, spent_7d_usd: 0, fetched_at: '' };
        expect((await pulseOnce()).find(n => n.kind === 'credits')).toBeUndefined();
    });

    it('säger till när något gått ner, men inte om oförändrat läge', async () => {
        h.health = [{ name: 'resend', status: 'down' }];
        const first = await pulseOnce();
        expect(first.find(n => n.kind === 'down')?.text).toContain('resend');
        expect((await pulseOnce()).find(n => n.kind === 'down')).toBeUndefined();
    });

    it('räknar en stillastående poller som nere', async () => {
        h.poller = { stale: true, secondsSince: 9000, lastWorker: null };
        expect((await pulseOnce()).find(n => n.kind === 'down')?.text).toMatch(/pollern/i);
    });
});
