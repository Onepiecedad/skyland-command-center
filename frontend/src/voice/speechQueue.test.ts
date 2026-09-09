import { describe, it, expect } from 'vitest';
import { splitReady } from './speechQueue';

describe('splitReady — vad rösten får börja läsa', () => {
    it('släpper en färdig mening och behåller resten', () => {
        const r = splitReady('Det ligger tolv prospekt i pipelinen just nu. Två av dem är');
        expect(r.ready).toEqual(['Det ligger tolv prospekt i pipelinen just nu.']);
        expect(r.rest).toBe('Två av dem är');
    });

    it('väntar tills meningen är slut', () => {
        const r = splitReady('Jag kollar CRM:et och återkommer med');
        expect(r.ready).toEqual([]);
        expect(r.rest).toMatch(/återkommer med$/);
    });

    it('delar inte mitt i en förkortning', () => {
        const r = splitReady('Vi hörde av oss till flera kliniker, t.ex. Sens à skin i Kungsbacka. Nästa steg är DM.');
        expect(r.ready[0]).toContain('t.ex. Sens à skin i Kungsbacka.');
        expect(r.ready).toHaveLength(1);
    });

    it('slår ihop en för kort inledning med nästa mening', () => {
        const r = splitReady('Japp. Det ligger tolv prospekt i pipelinen just nu. Sedan då?');
        expect(r.ready[0]).toBe('Japp. Det ligger tolv prospekt i pipelinen just nu.');
    });

    it('tar flera meningar i samma svep', () => {
        const r = splitReady('Första meningen är tillräckligt lång här. Andra meningen är också det. Tredje');
        expect(r.ready).toHaveLength(2);
        expect(r.rest).toBe('Tredje');
    });
});
