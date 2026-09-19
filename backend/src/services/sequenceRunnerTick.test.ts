/**
 * Tomgångsbuggen, 19 sep 2026.
 *
 * runDueEnrollments hämtade alla aktiva enrollments oavsett om deras sekvens
 * var igång. Låg sekvensen i draft eller paused upptäcktes det först långt ned
 * i processEnrollment, som då sköt upp raden 30 minuter och gav upp — varv
 * efter varv, i evighet. En enda sekvens som aldrig lämnat draft höll 44
 * enrollments snurrande dygnet runt och kostade omkring 150 Supabase-anrop i
 * timmen för arbete som aldrig kunde utföras.
 *
 * Testet låser fast det som gör att de aldrig hämtas: inner join mot sequences
 * med status active.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    anrop: [] as { select: string; eq: [string, unknown][] }[],
}));

vi.mock('../config', () => ({
    config: { OUTBOUND_ENABLED: false, OUTBOUND_DAILY_LIMIT: 5, OUTBOUND_MODE: 'auto' },
}));
vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./email', () => ({ getEmailProvider: () => ({ send: vi.fn() }) }));
vi.mock('./sms', () => ({ getSmsProvider: () => ({ send: vi.fn() }) }));

vi.mock('./supabase', () => ({
    supabase: {
        from(table: string) {
            if (table !== 'sequence_enrollments') {
                return {
                    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
                    update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
                    insert: () => Promise.resolve({ error: null }),
                };
            }
            const spar = { select: '', eq: [] as [string, unknown][] };
            const chain: Record<string, unknown> = {};
            chain.select = (s: string) => { spar.select = s; h.anrop.push(spar); return chain; };
            chain.eq = (col: string, val: unknown) => { spar.eq.push([col, val]); return chain; };
            chain.lte = () => chain;
            chain.order = () => chain;
            chain.limit = () => Promise.resolve({ data: [], error: null });
            chain.update = () => chain;
            return chain;
        },
    },
}));

import { runDueEnrollments } from './sequenceRunner';

beforeEach(() => { h.anrop = []; });

describe('runDueEnrollments', () => {
    it('hämtar bara enrollments vars sekvens är aktiv', async () => {
        await runDueEnrollments(25);

        expect(h.anrop).toHaveLength(1);
        const fraga = h.anrop[0];

        // Inner join, annars följer inte PostgREST med sekvensens status alls.
        expect(fraga.select).toContain('sequences!inner(status)');

        // Båda filtren måste finnas: enrollmenten aktiv OCH sekvensen aktiv.
        expect(fraga.eq).toContainEqual(['status', 'active']);
        expect(fraga.eq).toContainEqual(['sequences.status', 'active']);
    });

    it('frågar en gång per tick, inte en gång per enrollment', async () => {
        await runDueEnrollments(25);
        expect(h.anrop).toHaveLength(1);
    });
});
