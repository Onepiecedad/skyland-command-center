/**
 * SCC-36 — enhetstester för sessionshanteringen. Ingen DB, inget nätverk.
 * OBS: config läses vid import — testerna sätter env FÖRE import via vi.stubEnv? Nej:
 * config valideras vid modul-load. Vi testar därför de rena funktionerna via secret i env
 * som redan är satt i test-setup, alternativt hoppar över när secret saknas.
 */

import { describe, it, expect } from 'vitest';
import { parseCookie, timingSafeEqualStr } from './session';

describe('parseCookie', () => {
    it('hittar cookien bland flera', () => {
        expect(parseCookie('a=1; scc_session=abc.def; b=2', 'scc_session')).toBe('abc.def');
    });
    it('hanterar värden med =', () => {
        expect(parseCookie('scc_session=exp=123.sig', 'scc_session')).toBe('exp=123.sig');
    });
    it('returnerar null när cookien saknas', () => {
        expect(parseCookie('a=1; b=2', 'scc_session')).toBeNull();
    });
    it('url-avkodar värdet', () => {
        expect(parseCookie('scc_session=abc%2Edef', 'scc_session')).toBe('abc.def');
    });
});

describe('timingSafeEqualStr', () => {
    it('lika strängar → true', () => {
        expect(timingSafeEqualStr('hemligt-lösenord', 'hemligt-lösenord')).toBe(true);
    });
    it('olika strängar samma längd → false', () => {
        expect(timingSafeEqualStr('aaaa', 'aaab')).toBe(false);
    });
    it('olika längd → false utan att kasta', () => {
        expect(timingSafeEqualStr('kort', 'mycket längre sträng')).toBe(false);
    });
    it('tom sträng → false mot icke-tom', () => {
        expect(timingSafeEqualStr('', 'x')).toBe(false);
    });
});
