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
        contacts: [], messages: [], activities: [], bookings: [], opportunities: [], v_outreach_funnel: [], sequence_enrollments: [],
    };
    const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
    const updated: Array<{ table: string; patch: Record<string, unknown> }> = [];
    return { queues, inserted, updated };
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
                b.insert = (row: Record<string, unknown>) => { h.inserted.push({ table, row }); return Promise.resolve({ error: null }); };
                b.update = (patch: Record<string, unknown>) => { h.updated.push({ table, patch }); return b; };
                b.single = () => Promise.resolve(dequeue(table));
                b.maybeSingle = () => Promise.resolve(dequeue(table));
                b.then = (resolve: (v: unknown) => void) => resolve(dequeue(table));
                return b;
            },
        },
    };
});

import { getContactTimeline, buildFunnelRows, toCsv, aggregateFunnel, scoreBand, findLastTouch, buildCommissionRows, confirmBookingPaid, overrideReplyIntent, type FunnelRow } from './attribution';

beforeEach(() => {
    for (const k of Object.keys(h.queues)) h.queues[k] = [];
    h.inserted.length = 0;
    h.updated.length = 0;
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

// ---------------------------------------------------------------------------
// Granskning 6 sep: outreach-tratt, last touch, provisionsunderlag
// ---------------------------------------------------------------------------

function row(over: Partial<FunnelRow>): FunnelRow {
    return {
        enrollment_id: 'e', sequence_name: 'Reaktivering — beauty', contact_name: 'X', customer_id: null,
        area: 'göteborg', dm_vertical: 'beauty-reaktivering', dm_variant: 'v1', score: 50, research_cost_usd: 0.02,
        enrolled_at: '2026-09-01T00:00:00Z', enrollment_status: 'active', exit_reason: null,
        sent_count: 1, reply_count: 0, reply_intent: null, booking_count: 0,
        opportunity_status: 'open', stage_name: 'Contacted', value_sek: null, ...over,
    };
}

describe('aggregateFunnel', () => {
    it('räknar per ort: skickat, svar, intresse, bokat, vunnet, kostnad och andelar', () => {
        const rows = [
            row({ area: 'göteborg', sent_count: 2, reply_count: 1, reply_intent: 'interested', booking_count: 1, research_cost_usd: 0.1 }),
            row({ area: 'göteborg', sent_count: 1, research_cost_usd: 0.1 }),
            row({ area: 'göteborg', sent_count: 0, research_cost_usd: 0.05 }),   // inskriven, inget skickat än
            row({ area: 'malmö', sent_count: 1, reply_count: 1, reply_intent: 'no', opportunity_status: 'won', value_sek: 15000 }),
        ];
        const agg = aggregateFunnel(rows, 'area');
        const gbg = agg.find(a => a.key === 'göteborg')!;
        expect(gbg).toMatchObject({ enrolled: 3, sent: 2, messages_sent: 3, replied: 1, interested: 1, booked: 1, won: 0, cost_usd: 0.25 });
        expect(gbg.reply_rate).toBe(50);          // 1 av 2 skickade
        expect(gbg.booking_rate).toBe(50);
        expect(gbg.cost_per_booking_usd).toBe(0.25);
        const malmo = agg.find(a => a.key === 'malmö')!;
        expect(malmo).toMatchObject({ enrolled: 1, replied: 1, interested: 0, won: 1, value_sek: 15000 });
        expect(agg[0].key).toBe('göteborg');       // sorterad på enrolled
    });

    it('interested räknas bara när senaste klassningen är interested — ett missförstånd är inte ett säljsvar', () => {
        const agg = aggregateFunnel([row({ reply_count: 1, reply_intent: 'other' })], 'none');
        expect(agg[0]).toMatchObject({ replied: 1, interested: 0 });
    });

    it('score_band grupperar poäng i band och saknad poäng blir (okänd)', () => {
        const agg = aggregateFunnel([row({ score: 91 }), row({ score: 45 }), row({ score: null })], 'score_band');
        expect(agg.map(a => a.key).sort()).toEqual(['(okänd)', '40–59', '80+']);
        expect(scoreBand(60)).toBe('60–79');
    });

    it('andelar är null när inget skickats (ingen division med noll)', () => {
        const agg = aggregateFunnel([row({ sent_count: 0 })], 'none');
        expect(agg[0].reply_rate).toBeNull();
        expect(agg[0].cost_per_booking_usd).toBeNull();
    });
});

describe('findLastTouch', () => {
    it('returnerar senaste skickade meddelandet med enrollment ur metadata', async () => {
        h.queues.messages.push({ data: [{ id: 'm-9', channel: 'email', created_at: '2026-09-02T10:00:00Z', metadata: { contact_id: 'c-1', enrollment_id: 'e-1' } }], error: null });
        const t = await findLastTouch('c-1', new Date('2026-09-05T00:00:00Z'));
        expect(t).toEqual({ message_id: 'm-9', enrollment_id: 'e-1', channel: 'email', sent_at: '2026-09-02T10:00:00Z' });
    });
    it('null när inget utskick finns i fönstret', async () => {
        h.queues.messages.push({ data: [], error: null });
        expect(await findLastTouch('c-1')).toBeNull();
    });
});

describe('buildCommissionRows', () => {
    it('plattar ut bokningar med namn, kanal och sekvens från separata uppslag', async () => {
        h.queues.bookings.push({ data: [
            { id: 'b-1', customer_id: 'cust-1', contact_id: 'c-1', attendee_email: 'a@x.se', attendee_name: 'Anna', created_at: '2026-09-03T09:00:00Z', starts_at: '2026-09-10T09:00:00Z', status: 'booked',
              attributed_message_id: 'm-9', attributed_enrollment_id: 'e-1', attributed_touch_at: '2026-09-02T10:00:00Z', paid_confirmed_at: null, paid_value_sek: null, commission_sek: null },
            { id: 'b-2', customer_id: 'cust-1', contact_id: null, attendee_email: 'b@x.se', attendee_name: 'Berit', created_at: '2026-09-04T09:00:00Z', starts_at: null, status: 'booked',
              attributed_message_id: null, attributed_enrollment_id: null, attributed_touch_at: null, paid_confirmed_at: '2026-09-05T00:00:00Z', paid_value_sek: '2500', commission_sek: '1000' },
        ], error: null });
        h.queues.contacts.push({ data: [{ id: 'c-1', name: 'Anna Klinik' }], error: null });
        h.queues.messages.push({ data: [{ id: 'm-9', channel: 'email' }], error: null });
        h.queues.sequence_enrollments.push({ data: [{ id: 'e-1', sequence: { name: 'Reaktivering — beauty' } }], error: null });
        const rows = await buildCommissionRows('cust-1');
        expect(rows[0]).toMatchObject({ booking_id: 'b-1', contact: 'Anna Klinik', attributed: true, touch_channel: 'email', sequence: 'Reaktivering — beauty', commission_sek: null });
        expect(rows[1]).toMatchObject({ booking_id: 'b-2', contact: 'Berit', attributed: false, paid_value_sek: 2500, commission_sek: 1000 });
    });
});

describe('confirmBookingPaid / overrideReplyIntent', () => {
    it('bekräftelse uppdaterar bokningen och loggar en activity', async () => {
        h.queues.bookings.push({ data: [{ id: 'b-1', customer_id: 'cust-1', contact_id: 'c-1' }], error: null });
        const r = await confirmBookingPaid('b-1', { confirmed: true, paid_value_sek: 2500, commission_sek: 1000 });
        expect(r.ok).toBe(true);
        expect(h.updated.at(-1)?.patch).toMatchObject({ paid_value_sek: 2500, commission_sek: 1000 });
        expect(h.updated.at(-1)?.patch.paid_confirmed_at).toBeTruthy();
        expect(h.inserted.at(-1)).toMatchObject({ table: 'activities', row: { action: 'booking.paid_confirmed' } });
    });
    it('okänd bokning ger fel', async () => {
        h.queues.bookings.push({ data: [], error: null });
        expect((await confirmBookingPaid('nope', { confirmed: true })).ok).toBe(false);
    });
    it('manuell klassning loggas med samma prefix som klassificeraren', async () => {
        h.queues.contacts.push({ data: { customer_id: null }, error: null });
        await overrideReplyIntent('c-1', 'other', 'missförstånd — prisfråga, inte intresse');
        expect(h.inserted.at(-1)).toMatchObject({ table: 'activities', row: { action: 'reply.classified.manual', details: { contact_id: 'c-1', intent: 'other', manual: true } } });
    });
});
