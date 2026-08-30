/** SCC-46 — rena hjälpare i outreach.ts. Inga nätanrop. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('../config', () => ({ config: { OUTBOUND_ENABLED: false, OUTBOUND_MODE: 'auto', OUTREACH_WINDOW_ENABLED: true, OUTREACH_WINDOW_START_HOUR: 8, OUTREACH_WINDOW_END_HOUR: 17, OUTREACH_JITTER_MINUTES: 90 } }));

import { splitDm, normalizeSuppressionValue, domainOf, outboundMode, suppressionApplies, normalizePolicy, stockholmParts, insideOutreachWindow, msUntilWindowOpen, outreachJitterMs } from './outreach';
import { config } from '../config';

describe('splitDm', () => {
    it('delar på ---', () => {
        expect(splitDm({ dm_hook: 'A\n---\nB' })).toEqual({ opener: 'A', followup: 'B' });
    });
    it('CRLF och whitespace runt avdelaren', () => {
        expect(splitDm({ dm_hook: 'A\r\n --- \r\nB\r\n' })).toEqual({ opener: 'A', followup: 'B' });
    });
    it('utan avdelare = allt öppnare', () => {
        expect(splitDm({ dm_hook: 'Bara A' })).toEqual({ opener: 'Bara A', followup: '' });
    });
    it('tomt/saknat → null', () => {
        expect(splitDm({})).toBeNull();
        expect(splitDm(null)).toBeNull();
        expect(splitDm({ dm_hook: '   ' })).toBeNull();
    });
});

describe('normalisering', () => {
    it('email lowercase + trim', () => expect(normalizeSuppressionValue('email', ' Anna@Ex.SE ')).toBe('anna@ex.se'));
    it('telefon utan skräp', () => expect(normalizeSuppressionValue('phone', '+46 (0)70-123 45 67')).toBe('+460701234567'));
    it('domän', () => { expect(domainOf('a@B.se')).toBe('b.se'); expect(domainOf('ingen')).toBeNull(); });
});

describe('outboundMode', () => {
    it('off som default när OUTBOUND_ENABLED=false', () => expect(outboundMode()).toBe('off'));
    it('shadow oavsett OUTBOUND_ENABLED', () => {
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'shadow';
        expect(outboundMode()).toBe('shadow');
        config.OUTBOUND_ENABLED = true;
        expect(outboundMode()).toBe('shadow');
    });
    it('live kräver OUTBOUND_ENABLED=true och mode=auto', () => {
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'auto';
        config.OUTBOUND_ENABLED = true;
        expect(outboundMode()).toBe('live');
    });
});

describe('outboundMode — policy transactional', () => {
    it('går live trots OUTBOUND_ENABLED=false och OUTBOUND_MODE=shadow', () => {
        config.OUTBOUND_ENABLED = false;
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'shadow';
        expect(outboundMode('transactional')).toBe('live');
        expect(outboundMode('outreach')).toBe('shadow');
    });
    it('TRANSACTIONAL_OUTBOUND_ENABLED=false → off', () => {
        (config as unknown as { TRANSACTIONAL_OUTBOUND_ENABLED: boolean }).TRANSACTIONAL_OUTBOUND_ENABLED = false;
        expect(outboundMode('transactional')).toBe('off');
        (config as unknown as { TRANSACTIONAL_OUTBOUND_ENABLED: boolean }).TRANSACTIONAL_OUTBOUND_ENABLED = true;
    });
    it('normalizePolicy: allt utom transactional = outreach', () => {
        expect(normalizePolicy('transactional')).toBe('transactional');
        expect(normalizePolicy(null)).toBe('outreach');
        expect(normalizePolicy('whatever')).toBe('outreach');
    });
});

describe('suppressionApplies', () => {
    it('ingen träff → false', () => expect(suppressionApplies(null, 'transactional')).toBe(false));
    it('existing_customer stoppar outreach men inte transactional', () => {
        const hit = { reason: 'existing_customer' };
        expect(suppressionApplies(hit, 'outreach')).toBe(true);
        expect(suppressionApplies(hit, 'transactional')).toBe(false);
    });
    it('bounce/complaint/db_error stoppar båda', () => {
        for (const reason of ['bounce', 'complaint', 'opted_out', 'db_error: x', null]) {
            expect(suppressionApplies({ reason }, 'transactional')).toBe(true);
            expect(suppressionApplies({ reason }, 'outreach')).toBe(true);
        }
    });
});

describe('arbetstidsfönster (plan 2.5) — Europe/Stockholm', () => {
    // Fasta tidpunkter i UTC. Aug/sep 2026 = CEST (UTC+2).
    const TUE_10 = new Date('2026-09-01T08:00:00Z');   // tis 10:00 Sthlm
    const TUE_1730 = new Date('2026-09-01T15:30:00Z'); // tis 17:30 Sthlm — efter stängning
    const SAT_12 = new Date('2026-09-05T10:00:00Z');   // lör 12:00 Sthlm
    const TUE_0730 = new Date('2026-09-01T05:30:00Z'); // tis 07:30 Sthlm — före öppning

    it('stockholmParts ger rätt veckodag/timme', () => {
        expect(stockholmParts(TUE_10)).toMatchObject({ dow: 2, hour: 10 });
        expect(stockholmParts(SAT_12)).toMatchObject({ dow: 6, hour: 12 });
    });

    it('insideOutreachWindow: vardag 10:00 ja; 17:30, 07:30 och lördag nej', () => {
        expect(insideOutreachWindow(TUE_10)).toBe(true);
        expect(insideOutreachWindow(TUE_1730)).toBe(false);
        expect(insideOutreachWindow(TUE_0730)).toBe(false);
        expect(insideOutreachWindow(SAT_12)).toBe(false);
    });

    it('msUntilWindowOpen: 0 inne i fönstret', () => {
        expect(msUntilWindowOpen(TUE_10)).toBe(0);
    });

    it('msUntilWindowOpen: tis 07:30 → öppning inom 15–45 min', () => {
        const ms = msUntilWindowOpen(TUE_0730);
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThanOrEqual(45 * 60_000);
    });

    it('msUntilWindowOpen: lördag 12:00 → måndag morgon (~44 h), aldrig söndag', () => {
        const ms = msUntilWindowOpen(SAT_12);
        const target = new Date(SAT_12.getTime() + ms);
        expect(insideOutreachWindow(target)).toBe(true);
        expect(stockholmParts(target).dow).toBe(1);
        expect(ms).toBeGreaterThan(40 * 3_600_000);
        expect(ms).toBeLessThan(46 * 3_600_000);
    });

    it('outreachJitterMs: inom 0..JITTER minuter', () => {
        expect(outreachJitterMs(() => 0)).toBe(0);
        expect(outreachJitterMs(() => 0.999)).toBeLessThanOrEqual(90 * 60_000);
    });
});
