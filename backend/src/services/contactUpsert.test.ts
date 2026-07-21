/**
 * SCC-23 — enhetstester för upsertContactFromLead (DB-orkestreringen).
 *
 * Den pure logiken (derive/merge) täcks i contacts.test.ts. Här testas att
 * dedupe:t faktiskt fungerar mot databasen: en lead som redan finns UPPDATERAS
 * (ingen dubblett skapas), en ny lead INSERTAS, och att ett DB-strul returnerar
 * null i stället för att kasta — intake får aldrig 500:a på en CRM-hicka.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        existing: null as Record<string, unknown> | null,
        updateError: null as string | null,
        insertData: { id: 'new-1' } as Record<string, unknown> | null,
        insertError: null as string | null,
        throwOnSelect: false,
    };
    const calls = { insert: 0, update: 0 };
    return { state, calls };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./supabase', () => ({
    supabase: {
        from() {
            return {
                // dedupe-uppslag: .select().eq().limit().maybeSingle()
                select: () => ({
                    eq: () => ({
                        limit: () => ({
                            maybeSingle: () => {
                                if (h.state.throwOnSelect) throw new Error('DB nere');
                                return Promise.resolve({ data: h.state.existing, error: null });
                            },
                        }),
                    }),
                }),
                // update-gren: .update().eq()
                update: () => {
                    h.calls.update++;
                    return { eq: () => Promise.resolve({ error: h.state.updateError }) };
                },
                // insert-gren: .insert().select().single()
                insert: () => {
                    h.calls.insert++;
                    return {
                        select: () => ({
                            single: () =>
                                Promise.resolve({ data: h.state.insertData, error: h.state.insertError }),
                        }),
                    };
                },
            };
        },
    },
}));

import { upsertContactFromLead, type LeadPayload } from './contacts';

const lead: LeadPayload = {
    source: 'void_form',
    name: 'Anna Berg',
    email: 'anna@example.se',
    phone: '070-1234567',
};

beforeEach(() => {
    h.state.existing = null;
    h.state.updateError = null;
    h.state.insertData = { id: 'new-1' };
    h.state.insertError = null;
    h.state.throwOnSelect = false;
    h.calls.insert = 0;
    h.calls.update = 0;
});

describe('upsertContactFromLead — dedupe-orkestrering', () => {
    it('INSERTAR när ingen kontakt matchar dedupe_key', async () => {
        h.state.existing = null;

        const res = await upsertContactFromLead(lead, 'dk-1');

        expect(res).toEqual({ id: 'new-1', created: true });
        expect(h.calls.insert).toBe(1);
        expect(h.calls.update).toBe(0); // ingen uppdatering vid ny kontakt
    });

    it('UPPDATERAR befintlig kontakt i stället för att skapa dubblett', async () => {
        h.state.existing = { id: 'existing-9', name: 'Anna Berg', email: 'anna@example.se', status: 'qualified', custom: {} };

        const res = await upsertContactFromLead(lead, 'dk-1');

        expect(res).toEqual({ id: 'existing-9', created: false });
        expect(h.calls.update).toBe(1);
        expect(h.calls.insert).toBe(0); // INGEN dubblett
    });

    it('returnerar null (utan att kasta) när uppdateringen felar', async () => {
        h.state.existing = { id: 'existing-9', status: 'new', custom: {} };
        h.state.updateError = 'update kaputt';

        const res = await upsertContactFromLead(lead, 'dk-1');

        expect(res).toBeNull();
    });

    it('returnerar null (utan att kasta) när insert felar', async () => {
        h.state.existing = null;
        h.state.insertError = 'insert kaputt';
        h.state.insertData = null;

        const res = await upsertContactFromLead(lead, 'dk-1');

        expect(res).toBeNull();
    });

    it('sväljer ett kastat DB-fel och returnerar null (intake får inte 500:a)', async () => {
        h.state.throwOnSelect = true;

        const res = await upsertContactFromLead(lead, 'dk-1');

        expect(res).toBeNull();
    });
});
