/**
 * SCC-30 — enhetstester för e-postmappningen. Inga nätanrop, ingen DB.
 */

import { describe, it, expect } from 'vitest';
import { buildResendPayload } from './email';

const DEFAULTS = { from: 'Joakim — Skyland AI <joakim@send.skylandai.se>', replyTo: 'joakim@skylandai.se' };

describe('buildResendPayload', () => {
    it('mappar komplett mail korrekt', () => {
        const payload = buildResendPayload(
            { to: 'info@studio.se', subject: 'Hej', text: 'Kroppstext' },
            DEFAULTS
        );
        expect(payload).toEqual({
            from: DEFAULTS.from,
            to: ['info@studio.se'],
            subject: 'Hej',
            text: 'Kroppstext',
            reply_to: DEFAULTS.replyTo,
        });
    });

    it('explicit from/replyTo vinner över defaults', () => {
        const payload = buildResendPayload(
            { to: 'a@b.se', subject: 'x', text: 'y', from: 'Annan <x@send.skylandai.se>', replyTo: 'annan@skylandai.se' },
            DEFAULTS
        );
        expect(payload.from).toBe('Annan <x@send.skylandai.se>');
        expect(payload.reply_to).toBe('annan@skylandai.se');
    });

    it('trimmar mottagare och ämnesrad', () => {
        const payload = buildResendPayload(
            { to: '  info@studio.se  ', subject: '  Hej  ', text: 'x' },
            DEFAULTS
        );
        expect(payload.to).toEqual(['info@studio.se']);
        expect(payload.subject).toBe('Hej');
    });

    it('utelämnar reply_to när ingen finns', () => {
        const payload = buildResendPayload(
            { to: 'a@b.se', subject: 'x', text: 'y' },
            { from: DEFAULTS.from }
        );
        expect(payload.reply_to).toBeUndefined();
    });

    it('kastar på ogiltig mottagare', () => {
        expect(() => buildResendPayload({ to: 'inte-en-adress', subject: 'x', text: 'y' }, DEFAULTS)).toThrow(/mottagaradress/i);
        expect(() => buildResendPayload({ to: '', subject: 'x', text: 'y' }, DEFAULTS)).toThrow(/mottagaradress/i);
    });

    it('kastar när avsändare saknas helt', () => {
        expect(() => buildResendPayload({ to: 'a@b.se', subject: 'x', text: 'y' }, { from: '' })).toThrow(/avsändare/i);
    });

    it('kastar på tom ämnesrad eller text', () => {
        expect(() => buildResendPayload({ to: 'a@b.se', subject: '   ', text: 'y' }, DEFAULTS)).toThrow(/ämnesrad/i);
        expect(() => buildResendPayload({ to: 'a@b.se', subject: 'x', text: '' }, DEFAULTS)).toThrow(/meddelandetext/i);
    });
});
