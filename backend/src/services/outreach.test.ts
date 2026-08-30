/** SCC-46 — rena hjälpare i outreach.ts. Inga nätanrop. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('../config', () => ({ config: { OUTBOUND_ENABLED: false, OUTBOUND_MODE: 'auto' } }));

import { splitDm, normalizeSuppressionValue, domainOf, outboundMode, suppressionApplies, normalizePolicy } from './outreach';
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
