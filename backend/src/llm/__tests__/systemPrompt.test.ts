/**
 * Systemprompten är den enda artefakt som påverkar VARJE svar Alex ger.
 * Testerna vaktar de tre fel som faktiskt uppstått i den: påhittade siffror,
 * kopior av databasen som hinner bli inaktuella, och regler som motsäger
 * varandra så att Alex blir obeslutsam.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt';

const KUNDER = [
    { id: '1', name: 'Thomas - MarinMekaniker', slug: 'thomas', site_tenant_slug: 'marinmekaniker' },
    { id: '2', name: 'Vinnie - All Gold Tattoo', slug: 'allgold', site_tenant_slug: null },
];
const PIPELINES = [
    { name: 'Cold Experience — leads' },
    { name: 'Prospecting (Agency)', is_default: true },
];

describe('systemprompten', () => {
    const p = buildSystemPrompt(KUNDER, PIPELINES);

    it('listar kunderna och markerar vilka som har spårad hemsida', () => {
        expect(p).toContain('Thomas - MarinMekaniker (slug: thomas) — har spårad hemsida');
        expect(p).toContain('Vinnie - All Gold Tattoo (slug: allgold)');
        expect(p).not.toContain('All Gold Tattoo (slug: allgold) — har spårad');
    });

    it('listar pipelines från databasen i stället för en hårdkodad kopia', () => {
        expect(p).toContain('Cold Experience — leads');
        expect(p).toContain('Prospecting (Agency) (standard)');
    });

    it('innehåller inga hårdkodade antal — siffror ska hämtas i stunden', () => {
        // "37 st" stod i prompten i månader efter att antalet ändrats.
        expect(p).not.toMatch(/\b\d+\s*(st|stycken)\b/);
        expect(p).toContain('get_crm_stats');
    });

    it('nämner inte avvecklade delar av systemet', () => {
        expect(p.toLowerCase()).not.toContain('n8n');
    });

    it('säger inte både att Alex aldrig får köra något och att han får delegera', () => {
        expect(p).not.toMatch(/får ALDRIG köra eller dispatcha/);
        expect(p).toContain('delegate_task');
        expect(p).toMatch(/allt som lämnar huset/i);
    });

    it('drar gränsen mot Cold Experience-agenten', () => {
        expect(p).toMatch(/EGEN agent/);
        expect(p).toMatch(/svarar aldrig en gäst/i);
    });

    it('klarar sig utan data', () => {
        const tom = buildSystemPrompt([], []);
        expect(tom).toContain('(Inga kunder registrerade)');
        expect(tom).toContain('(Kunde inte läsa pipelines just nu)');
    });
});
