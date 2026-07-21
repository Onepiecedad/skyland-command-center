/**
 * SCC-36 — tester för attribution (lead→kontakt→opportunity→bokning).
 *
 * Affärskritiskt: provisionsspårningen bygger på att kunna följa varifrån en
 * bokning kom. Testerna säkrar timeline-aggregeringen + summeringen, funnel-
 * radernas booking-join, null-guarden när kontakten saknas, och CSV-escapingen
 * (export­vägen). Supabase mockas med en per-tabell-FIFO.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const queues: Record<string, Array<unknown>> = {
        contacts: [], messages: [], activities: [], bookings: [], opportunities: [],
    };
    return { queues };
});

vi.mock('./supabase', () => {
    const DEFAULT = { data: null, error: null };
    const dequeue = (table: string) => h.queues[table]?.shift() ?? DEFAULT;
    return {
        supabase: {
            from(table: string) {
                const b: Record<string, unknown> = {};
                const pass = ['select', 'eq', 'in', 'gte', 'lte', 'like', 'ilike',
                    'order', 'limit', 'contains', 'neq', 'is'];
                for (const m of pass) b[m] = () => b;
                b.single = () => Promise.resolve(dequeue(table));
                b.maybeSingle = () => Promise.resolve(dequeue(table));
                b.then = (resolve: (v: unknown) => void) => resolve(dequeue(table));
                return b;
            },
        },
    };
});

import { getContactTimeline, buildFunnelRows, toCsv } from './attribution';

beforeEach(() => {
    for (const k of Object.keys(h.queues)) h.queues[k] = [];
});

describe('getContactTimeline', () => {
    it('aggregerar tvärkanals-händelser, summerar och sorterar stigande', async () => {
        h.queues.contacts = [{ data: { id: 'c-1', name: 'Anna' }, error: null }];
        h.queues.messages = [{ data: [
            { created_at: '2026-01-02', channel: 'email', direction: 'outbound', content: 'Hej\nrad2' },
            { created_at: '2026-01-01', channel: 'sms', direction: 'outbound', content: 'sms-text' },
            { created_at: '2026-01-03', channel: 'email', direction: 'inbound', content: 'svar' },
        ], error: null }];
        h.queues.activities = [{ data: [{ created_at: '2026-01-02', action: 'stage_moved' }], error: null }];
        h.queues.bookings = [{ data: [{ created_at: '2026-01-04', status: 'confirmed', title: 'Möte', starts_at: '2026-01-10' }], error: null }];
        h.queues.opportunities = [{ data: [{ title: 'Deal', value_sek: 1000 }], error: null }];

        const res = await getContactTimeline('c-1');

        expect(res).not.toBeNull();
        expect(res!.summary).toEqual({ emails_out: 1, emails_in: 1, sms_out: 1, bookings: 1, opportunities: 1 });
        expect(res!.timeline).toHaveLength(5); // 3 msg + 1 activity + 1 booking
        expect(res!.timeline[0].ts).toBe('2026-01-01'); // sorterad stigande
        // första meddelandet trunkeras till första raden
        const firstMsg = res!.timeline.find(e => e.kind === 'message' && e.ts === '2026-01-02');
        expect(firstMsg!.summary).toBe('Hej');
    });

    it('returnerar null när kontakten saknas', async () => {
        h.queues.contacts = [{ data: null, error: null }];
        const res = await getContactTimeline('saknas');
        expect(res).toBeNull();
    });
});

describe('buildFunnelRows', () => {
    it('joinar bokningar per kontakt och plattar ut nästlade fält', async () => {
        h.queues.opportunities = [{ data: [{
            id: 'o1', title: 'Deal A', value_sek: 5000, status: 'open', created_at: '2026-01-01',
            contact: { id: 'c-1', name: 'Anna', email: 'a@x.se', source: 'void_form' },
            stage: { name: 'Ny' }, pipeline: { name: 'Sales' },
        }], error: null }];
        h.queues.bookings = [{ data: [
            { contact_id: 'c-1', status: 'confirmed' },
            { contact_id: 'c-1', status: 'cancelled' },
        ], error: null }];

        const rows = await buildFunnelRows();

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            opportunity: 'Deal A', pipeline: 'Sales', stage: 'Ny',
            contact: 'Anna', email: 'a@x.se', source: 'void_form',
            bookings: 2, last_booking_status: 'cancelled',
        });
    });
});

describe('toCsv', () => {
    it('tom lista → tom sträng', () => {
        expect(toCsv([])).toBe('');
    });

    it('skriver header + rader från nycklarna', () => {
        const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
        expect(csv).toBe('a,b\n1,x\n2,y');
    });

    it('citerar fält med komma, citattecken eller radbrytning', () => {
        const csv = toCsv([{ name: 'Berg, AB', note: 'säger "hej"', multi: 'rad1\nrad2' }]);
        const line = csv.split('\n').slice(1).join('\n'); // datarad(er)
        expect(line).toContain('"Berg, AB"');
        expect(line).toContain('"säger ""hej"""');
        expect(csv).toContain('"rad1\nrad2"');
    });
});
