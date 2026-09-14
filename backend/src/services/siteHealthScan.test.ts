/**
 * Tester för sajthälso-skanningen.
 *
 * Det som måste hålla: custom får aldrig skrivas över (score/tier/dm_hook bor
 * där), en domän som sitter på flera kontakter kollas en gång, färska rader
 * kollas inte om, och INCONCLUSIVE räknas aldrig som ett lead.
 * Supabase och siteHealth mockas — testerna rör aldrig nätet.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    contacts: [] as Array<Record<string, unknown>>,
    selectError: null as { message: string } | null,
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    updateError: null as { message: string } | null,
    checkResults: [] as Array<Record<string, unknown>>,
    checkedDomains: [] as string[][],
    checkThrows: false,
}));

vi.mock('./supabase', () => ({
    supabase: {
        from() {
            const b: Record<string, unknown> = {};
            let mode: 'select' | 'update' = 'select';
            let pendingPatch: Record<string, unknown> = {};
            let targetId = '';

            b.select = () => { mode = 'select'; return b; };
            b.update = (patch: Record<string, unknown>) => { mode = 'update'; pendingPatch = patch; return b; };
            b.not = () => b;
            b.or = () => b;
            b.limit = () => b;
            b.eq = (_col: string, val: string) => { targetId = val; return b; };
            b.then = (resolve: (v: unknown) => void) => {
                if (mode === 'update') {
                    if (!h.updateError) h.updates.push({ id: targetId, patch: pendingPatch });
                    return resolve({ data: null, error: h.updateError });
                }
                return resolve({ data: h.contacts, error: h.selectError });
            };
            return b;
        },
    },
}));

vi.mock('./logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

vi.mock('./siteHealth', () => ({
    checkSites: vi.fn(async (domains: string[]) => {
        h.checkedDomains.push(domains);
        return h.checkResults;
    }),
    checkSite: vi.fn(async (domain: string) => {
        h.checkedDomains.push([domain]);
        if (h.checkThrows) throw new Error('nätverket dog');
        return h.checkResults[0] ?? { domain, verdict: 'OK', sellable: false, evidence: 'ok' };
    }),
}));

const { scanContactSites, toDomain, gateOnSiteHealth } = await import('./siteHealthScan');

const contact = (over: Record<string, unknown> = {}) => ({
    id: 'c1', company: 'Testklinik', website: 'https://test.se', custom: null, ...over,
});
const result = (over: Record<string, unknown> = {}) => ({
    domain: 'test.se', verdict: 'SERVER_DEAD', sellable: true,
    evidence: 'Ingen server svarar', ...over,
});

beforeEach(() => {
    h.contacts = []; h.selectError = null; h.updates = []; h.updateError = null;
    h.checkResults = []; h.checkedDomains = []; h.checkThrows = false;
});

describe('toDomain', () => {
    it('normaliserar protokoll, www, versaler och sökväg', () => {
        expect(toDomain('HTTPS://WWW.Foo.se/kontakt?a=1')).toBe('foo.se');
    });
    it('avvisar sociala plattformar — de säger inget om egen sajt', () => {
        expect(toDomain('https://facebook.com/klinik')).toBe('');
        expect(toDomain('https://www.instagram.com/x')).toBe('');
        expect(toDomain('bit.ly/abc')).toBe('');
    });
    it('avvisar skräp och tomt', () => {
        expect(toDomain('inte en domän')).toBe('');
        expect(toDomain(null)).toBe('');
        expect(toDomain('localhost')).toBe('');
    });
});

describe('scanContactSites', () => {
    it('mergar custom istället för att skriva över det', async () => {
        h.contacts = [contact({ custom: { score: 87, tier: 'A', dm_hook: 'kroken' } })];
        h.checkResults = [result()];

        await scanContactSites();

        expect(h.updates).toHaveLength(1);
        const custom = h.updates[0].patch.custom as Record<string, unknown>;
        expect(custom.score).toBe(87);
        expect(custom.tier).toBe('A');
        expect(custom.dm_hook).toBe('kroken');
        expect((custom.site_health as Record<string, unknown>).verdict).toBe('SERVER_DEAD');
    });

    it('kollar en delad domän en gång men sparar på båda kontakterna', async () => {
        h.contacts = [
            contact({ id: 'a', website: 'https://delad.se' }),
            contact({ id: 'b', website: 'http://www.delad.se/om' }),
        ];
        h.checkResults = [result({ domain: 'delad.se' })];

        const s = await scanContactSites();

        expect(h.checkedDomains[0]).toEqual(['delad.se']);
        expect(h.updates.map(u => u.id).sort()).toEqual(['a', 'b']);
        expect(s.sellable).toBe(2);
    });

    it('hoppar över rader som kontrollerats nyligen', async () => {
        h.contacts = [contact({
            custom: { site_health: { checked_at: new Date().toISOString(), verdict: 'OK', sellable: false } },
        })];

        const s = await scanContactSites();

        expect(s.skipped).toBe(1);
        expect(h.checkedDomains).toHaveLength(0);
        expect(h.updates).toHaveLength(0);
    });

    it('kontrollerar om när resultatet är gammalt', async () => {
        const old = new Date(Date.now() - 90 * 864e5).toISOString();
        h.contacts = [contact({ custom: { site_health: { checked_at: old, verdict: 'OK', sellable: false } } })];
        h.checkResults = [result()];

        const s = await scanContactSites({ recheckAfterDays: 30 });

        expect(s.scanned).toBe(1);
        expect(h.updates).toHaveLength(1);
    });

    it('räknar INCONCLUSIVE som osäkert, aldrig som lead', async () => {
        h.contacts = [contact()];
        h.checkResults = [result({ verdict: 'INCONCLUSIVE', sellable: false, evidence: 'WAF' })];

        const s = await scanContactSites();

        expect(s.inconclusive).toBe(1);
        expect(s.sellable).toBe(0);
        expect(s.leads).toHaveLength(0);
    });

    it('dryRun skriver ingenting men rapporterar träffar', async () => {
        h.contacts = [contact()];
        h.checkResults = [result()];

        const s = await scanContactSites({ dryRun: true });

        expect(h.updates).toHaveLength(0);
        expect(s.sellable).toBe(1);
        expect(s.leads[0].contact_id).toBe('c1');
    });

    it('räknar skrivfel istället för att kasta', async () => {
        h.contacts = [contact()];
        h.checkResults = [result()];
        h.updateError = { message: 'RLS' };

        const s = await scanContactSites();

        expect(s.write_errors).toBe(1);
        expect(s.sellable).toBe(1);
    });

    it('kastar med tydligt meddelande när kontakterna inte går att läsa', async () => {
        h.selectError = { message: 'timeout' };
        await expect(scanContactSites()).rejects.toThrow(/timeout/);
    });

    it('läser adressen från custom.website när kolumnen är tom', async () => {
        h.contacts = [contact({ website: null, custom: { website: 'https://www.frankolle.se/om' } })];
        h.checkResults = [result({ domain: 'frankolle.se' })];

        const s = await scanContactSites();

        expect(h.checkedDomains[0]).toEqual(['frankolle.se']);
        expect(s.sellable).toBe(1);
        expect(s.leads[0].domain).toBe('frankolle.se');
    });

    it('föredrar kolumnen framför custom när båda finns', async () => {
        h.contacts = [contact({ website: 'https://kolumn.se', custom: { website: 'https://gammal.se' } })];
        h.checkResults = [result({ domain: 'kolumn.se' })];

        await scanContactSites();

        expect(h.checkedDomains[0]).toEqual(['kolumn.se']);
    });

    it('hoppar över sociala länkar utan att kalla checkSites', async () => {
        h.contacts = [contact({ website: 'https://facebook.com/klinik' })];

        const s = await scanContactSites();

        expect(s.skipped).toBe(1);
        expect(h.checkedDomains).toHaveLength(0);
    });
});


describe('gateOnSiteHealth — grinden vid intaget', () => {
    it('slänger företag med fungerande sajt', async () => {
        h.checkResults = [result({ verdict: 'OK', sellable: false, evidence: 'HTTP 200' })];
        const d = await gateOnSiteHealth('https://fin.se');
        expect(d.action).toBe('skip');
    });

    it('slänger MOVED — de har en sajt, vi har fel adress', async () => {
        h.checkResults = [result({ verdict: 'MOVED', sellable: false, evidence: 'nytt namn' })];
        expect((await gateOnSiteHealth('https://gammal.se')).action).toBe('skip');
    });

    it('släpper igenom trasiga och märker kortet', async () => {
        h.checkResults = [result({ verdict: 'DOMAIN_GONE', sellable: true, evidence: 'DNS svarar inte' })];
        const d = await gateOnSiteHealth('https://borta.se');
        expect(d.action).toBe('create');
        expect(d.site_health?.verdict).toBe('DOMAIN_GONE');
        expect(d.site_health?.checked_at).toBeTruthy();
    });

    it('släpper igenom vid INCONCLUSIVE — släng aldrig på okunskap', async () => {
        h.checkResults = [result({ verdict: 'INCONCLUSIVE', sellable: false, evidence: 'WAF' })];
        const d = await gateOnSiteHealth('https://blockerad.se');
        expect(d.action).toBe('create');
        expect(d.note).toMatch(/kontrollera manuellt/);
    });

    it('släpper igenom när adress saknas, utan att kalla kontrollen', async () => {
        const d = await gateOnSiteHealth(null);
        expect(d.action).toBe('create');
        expect(d.site_health).toBeUndefined();
        expect(h.checkedDomains).toHaveLength(0);
    });

    it('släpper igenom sociala länkar — de säger inget om egen sajt', async () => {
        const d = await gateOnSiteHealth('https://facebook.com/klinik');
        expect(d.action).toBe('create');
        expect(h.checkedDomains).toHaveLength(0);
    });

    it('släpper igenom när kontrollen kraschar', async () => {
        h.checkThrows = true;
        const d = await gateOnSiteHealth('https://strular.se');
        expect(d.action).toBe('create');
        expect(d.note).toMatch(/kraschade/);
    });
});
