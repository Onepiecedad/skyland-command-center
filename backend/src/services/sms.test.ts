/**
 * SEQ-5 — enhetstester för SMS-mappning + E.164. Inga nätanrop, ingen DB.
 */

import { describe, it, expect } from 'vitest';
import { normalizeE164, buildElksForm } from './sms';

describe('normalizeE164', () => {
    it('svenskt 07-nummer → +46', () => {
        expect(normalizeE164('070-123 45 67')).toBe('+46701234567');
    });
    it('redan E.164 lämnas orört', () => {
        expect(normalizeE164('+46701234567')).toBe('+46701234567');
    });
    it('00-prefix → +', () => {
        expect(normalizeE164('0046701234567')).toBe('+46701234567');
    });
    it('landsnummer utan plus → +', () => {
        expect(normalizeE164('46701234567')).toBe('+46701234567');
    });
    it('tar bort mellanslag, bindestreck och parenteser', () => {
        expect(normalizeE164('(070) 123 45 67')).toBe('+46701234567');
    });
    it('kastar på tomt', () => {
        expect(() => normalizeE164('')).toThrow();
    });
});

describe('buildElksForm', () => {
    it('bygger korrekt form med default-avsändare', () => {
        const form = buildElksForm({ to: '070-1234567', text: 'Hej' }, { from: 'Skyland' });
        expect(form).toEqual({ from: 'Skyland', to: '+46701234567', message: 'Hej' });
    });
    it('explicit from vinner över default', () => {
        const form = buildElksForm({ to: '+46701234567', text: 'Hej', from: '+46766861005' }, { from: 'Skyland' });
        expect(form.from).toBe('+46766861005');
    });
    it('kastar utan avsändare', () => {
        expect(() => buildElksForm({ to: '070', text: 'x' }, { from: '' })).toThrow(/avsändare/);
    });
    it('kastar på tom text', () => {
        expect(() => buildElksForm({ to: '070', text: '  ' }, { from: 'Skyland' })).toThrow(/text/);
    });
});
