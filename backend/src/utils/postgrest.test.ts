/** Kommatecken i sökterm får inte spränga PostgREST-or-filtret (bugg 30 aug 2026). */
import { describe, it, expect } from 'vitest';
import { ilikeOr, pgrstQuote } from './postgrest';

describe('ilikeOr', () => {
    it('citerar värdet så komma och parentes är ofarliga', () => {
        expect(ilikeOr(['name'], 'Vaxning, Laser (Brasiliansk)'))
            .toBe('name.ilike."%Vaxning, Laser (Brasiliansk)%"');
    });
    it('flera fält separeras med komma UTANFÖR citaten', () => {
        expect(ilikeOr(['a', 'b'], 'x')).toBe('a.ilike."%x%",b.ilike."%x%"');
    });
    it('escapar citattecken och backslash i termen', () => {
        expect(pgrstQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
    });
});
