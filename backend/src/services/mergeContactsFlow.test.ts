/**
 * SCC-41 — happy-path för mergeContacts (till skillnad från de destruktiva
 * skydden i contactMerge.test.ts).
 *
 * GHL tappar tyst data vid merge. SCC ska i stället FLYTTA allt från dubbletten
 * till primären — opportunities, bokningar, enrollments, meddelanden, aktiviteter
 * — och radera dubbletten SIST. Testet verifierar att flytt-räknarna stämmer och
 * att raderingen faktiskt sker.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const queues: Record<string, Array<unknown>> = {
        contacts: [], opportunities: [], bookings: [], sequence_enrollments: [],
        messages: [], activities: [],
    };
    const calls = { contactsDeletes: 0 };
    return { queues, calls };
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
                const pass = ['select', 'insert', 'update', 'eq', 'in',
                    'gte', 'lte', 'like', 'order', 'limit', 'contains', 'neq', 'is'];
                for (const m of pass) b[m] = () => b;
                b.delete = () => { if (table === 'contacts') h.calls.contactsDeletes++; return b; };
                b.single = () => Promise.resolve(dequeue(table));
                b.maybeSingle = () => Promise.resolve(dequeue(table));
                b.then = (resolve: (v: unknown) => void) => resolve(dequeue(table));
                return b;
            },
        },
    };
});

import { mergeContacts } from './contactMerge';

const primary = {
    id: 'primary-1', name: 'Primär AB', email: 'primar@x.se', phone: '070-111',
    custom: { a: 1 }, tags: ['vip'], customer_id: 'cust-1',
};
const dup = {
    id: 'dup-1', name: 'Dubblett AB', email: null, phone: '071-222',
    custom: { b: 2 }, tags: ['lead'], customer_id: 'cust-1',
};

beforeEach(() => {
    h.calls.contactsDeletes = 0;
    h.queues.contacts = [
        { data: primary, error: null },   // primär-uppslag
        { data: dup, error: null },       // dubblett-uppslag
        { error: null },                  // steg 3: contacts.update(sammanslagning)
        { error: null },                  // steg 5: contacts.delete(dubbletten)
    ];
    h.queues.opportunities = [{ data: [{ id: 'o1' }, { id: 'o2' }], error: null }]; // 2 flyttade
    h.queues.bookings = [{ data: [{ id: 'b1' }], error: null }];                    // 1 flyttad
    h.queues.sequence_enrollments = [{ data: [], error: null }];                    // 0 flyttade
    h.queues.messages = [{ data: [], error: null }];                               // repoint: 0 rader
    h.queues.activities = [
        { data: [], error: null },        // repoint: 0 rader
        { error: null },                  // audit-insert
    ];
});

describe('mergeContacts — happy path', () => {
    it('flyttar entiteter och rapporterar korrekta räknare', async () => {
        const res = await mergeContacts('primary-1', 'dup-1');

        expect(res.primary_id).toBe('primary-1');
        expect(res.moved).toEqual({
            opportunities: 2,
            bookings: 1,
            enrollments: 0,
            messages: 0,
            activities: 0,
        });
    });

    it('raderar dubbletten (exakt en contacts-delete)', async () => {
        await mergeContacts('primary-1', 'dup-1');
        expect(h.calls.contactsDeletes).toBe(1);
    });
});
