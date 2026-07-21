/**
 * SCC-42 — tester för sekvens-triggrarna (koppling SCC-händelse → drip-motor).
 *
 * Affärskritiskt: fireExit är det som STOPPAR utskick när en lead svarat
 * (reply_received) — annars fortsätter systemet mejla någon som redan svarat.
 * fireTrigger skriver bara in kontakten i sekvenser vars trigger_config matchar.
 * enrollContact behandlar unik-krock (redan aktiv) som icke-fel. Supabase mockad.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        sequences: [] as Array<unknown>,   // FIFO för sequences.select
        insertError: null as unknown,
        updateError: null as unknown,
    };
    const calls = { inserts: [] as Record<string, unknown>[], updates: 0 };
    return { state, calls };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./supabase', () => ({
    supabase: {
        from(table: string) {
            if (table === 'sequences') {
                const b: Record<string, unknown> = {};
                b.select = () => b; b.eq = () => b;
                b.then = (resolve: (v: unknown) => void) =>
                    resolve(h.state.sequences.shift() ?? { data: [], error: null });
                return b;
            }
            // sequence_enrollments
            return {
                insert: (payload: Record<string, unknown>) => {
                    h.calls.inserts.push(payload);
                    return Promise.resolve({ error: h.state.insertError });
                },
                update: () => {
                    const u: Record<string, unknown> = {};
                    u.eq = () => u;
                    u.in = () => { h.calls.updates++; return Promise.resolve({ error: h.state.updateError }); };
                    return u;
                },
            };
        },
    },
}));

import { enrollContact, fireTrigger, fireExit } from './sequenceEvents';

beforeEach(() => {
    h.state.sequences = [];
    h.state.insertError = null;
    h.state.updateError = null;
    h.calls.inserts = [];
    h.calls.updates = 0;
});

describe('enrollContact', () => {
    it('lyckad insert → enrolled:true', async () => {
        const res = await enrollContact('seq-1', 'c-1');
        expect(res).toEqual({ enrolled: true });
        expect(h.calls.inserts).toHaveLength(1);
    });

    it('unik-krock (23505) → already_active, inte ett fel', async () => {
        h.state.insertError = { code: '23505', message: 'duplicate' };
        const res = await enrollContact('seq-1', 'c-1');
        expect(res).toEqual({ enrolled: false, reason: 'already_active' });
    });

    it('annat DB-fel → enrolled:false med orsak', async () => {
        h.state.insertError = { code: '500', message: 'boom' };
        const res = await enrollContact('seq-1', 'c-1');
        expect(res.enrolled).toBe(false);
        expect(res.reason).toBe('boom');
    });
});

describe('fireTrigger', () => {
    it('skriver bara in kontakten i sekvenser vars trigger_config matchar', async () => {
        h.state.sequences = [{
            data: [
                { id: 's-match', trigger_config: { stage_id: 'st-1' } },
                { id: 's-nomatch', trigger_config: { stage_id: 'st-2' } },
                { id: 's-empty', trigger_config: {} }, // tom config matchar allt
            ],
            error: null,
        }];

        await fireTrigger('stage_changed', 'c-1', { stage_id: 'st-1' });

        const enrolledSeqs = h.calls.inserts.map(i => i.sequence_id);
        expect(enrolledSeqs).toContain('s-match');
        expect(enrolledSeqs).toContain('s-empty');
        expect(enrolledSeqs).not.toContain('s-nomatch');
    });

    it('inga aktiva sekvenser → inga enrollments', async () => {
        h.state.sequences = [{ data: [], error: null }];
        await fireTrigger('stage_changed', 'c-1', { stage_id: 'st-1' });
        expect(h.calls.inserts).toHaveLength(0);
    });
});

describe('fireExit — stoppar drips', () => {
    it('avslutar enrollments när en sekvens listar händelsen i exit_on', async () => {
        h.state.sequences = [{
            data: [
                { id: 's-1', exit_on: ['reply_received'] },
                { id: 's-2', exit_on: ['booking_created'] },
            ],
            error: null,
        }];

        await fireExit('reply_received', 'c-1');

        expect(h.calls.updates).toBe(1); // uppdaterade enrollments → exited
    });

    it('ingen sekvens listar händelsen → ingen uppdatering', async () => {
        h.state.sequences = [{ data: [{ id: 's-2', exit_on: ['booking_created'] }], error: null }];
        await fireExit('reply_received', 'c-1');
        expect(h.calls.updates).toBe(0);
    });
});
