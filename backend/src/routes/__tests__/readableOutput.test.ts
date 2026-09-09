/**
 * 9 sep läste Alex upp en hel research-JSON i högtalaren — klamrar, engelska
 * nyckelnamn, allt. Det får inte hända igen: det som VISAS och det som LÄSES
 * UPP är två olika saker så fort svaret inte är prosa.
 */
import { describe, it, expect } from 'vitest';
import { readableOutput } from '../dispatch';

const RESEARCH = {
    company: 'LOA Ink',
    aka: 'Law of Attraction Ink',
    artists: [{ name: 'Jimmie', specialty: 'Black & grey' }, { name: 'Paulina', specialty: 'Color' }],
    tier_assessment: 'B — starka omdömen men fel ort',
};

describe('readableOutput', () => {
    it('läser upp sammanfattningen när agenten skickat en', () => {
        const r = readableOutput({ summary: 'LOA Ink i Lund drivs av två tatuerare.', artists: [] }, 'Research');
        expect(r.speech).toBe('LOA Ink i Lund drivs av två tatuerare.');
        expect(r.text).toContain('LOA Ink i Lund');
    });

    it('läser ALDRIG upp rå JSON — bara en kort hänvisning till tråden', () => {
        const r = readableOutput(RESEARCH, 'Research på LOA Ink');
        expect(r.speech).not.toMatch(/[{}[\]"]/);
        expect(r.speech).toMatch(/står i tråden/);
        expect(r.speech.length).toBeLessThan(200);
    });

    it('visar ändå innehållet läsbart i tråden', () => {
        const r = readableOutput(RESEARCH, 'Research');
        expect(r.text).toContain('company: LOA Ink');
        expect(r.text).toContain('Jimmie');
        expect(r.text).not.toContain('{');
    });

    it('nämner att det finns mer när sammanfattningen inte är hela svaret', () => {
        const r = readableOutput({ summary: 'Klart.', a: 1, b: 2 }, 'Research');
        expect(r.text).toMatch(/2 fält med detaljer/);
        expect(r.speech).toBe('Klart.');
    });

    it('säger till när agenten inte skickade något alls', () => {
        const r = readableOutput({}, 'Uppdraget');
        expect(r.text).toMatch(/inget läsbart resultat/);
        expect(r.speech).toBe(r.text);
    });
});
