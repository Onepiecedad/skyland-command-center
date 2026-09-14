/**
 * Sajthälsa på befintliga kontakter.
 *
 * Kör siteHealth mot `contacts.website` och lägger resultatet i
 * `contacts.custom.site_health`. Mergar alltid custom — skriver aldrig över
 * score, tier, booking_flow eller dm_hook med ett partiellt objekt.
 *
 * VAR DEN SKA KÖRAS: från ett nät med vanligt rykte, dvs. där discover redan
 * kör. Från ett datacenter-IP (Render) svarar många friska sajter 403 och
 * klassas som INCONCLUSIVE. Det är säkert — INCONCLUSIVE blir aldrig ett lead
 * — men träffarna uteblir. Summaryns `inconclusive` visar om nätet är fel.
 *
 * Bakgrund: skarp körning mot 162 domäner 2026-09-14 gav 11 äkta träffar och
 * 6 falska positiva innan reglerna i siteHealth.ts skärptes. Se
 * docs/trasiga-sajter-2026-09-14.csv.
 */

import { supabase } from './supabase';
import { logger } from './logger';
import { checkSite, checkSites, type SiteHealth, type Verdict } from './siteHealth';

/** Plattformar där en träff inte säger något om företagets egen sajt. */
const NOT_OWN_SITE = [
    'facebook.', 'instagram.', 'linkedin.', 'bokadirekt.', 'tiktok.',
    'youtube.', 'bit.ly', 'linktr.ee', 'google.com', 'wa.me',
];

const RECHECK_AFTER_DAYS = 30;
const DEFAULT_LIMIT = 200;

export interface StoredSiteHealth {
    verdict: Verdict;
    sellable: boolean;
    evidence: string;
    final_url?: string;
    checked_at: string;
}

export interface ScanLead {
    contact_id: string;
    company: string | null;
    domain: string;
    verdict: Verdict;
    evidence: string;
}

export interface ScanSummary {
    scanned: number;
    skipped: number;
    sellable: number;
    inconclusive: number;
    ok: number;
    write_errors: number;
    by_verdict: Record<string, number>;
    leads: ScanLead[];
}

interface ContactRow {
    id: string;
    company: string | null;
    website: string | null;
    custom: Record<string, unknown> | null;
}

/**
 * Adressen bor på två ställen: kolumnen `website` och `custom.website`.
 * Prospektkorten i CRM:et läser custom-varianten, och sex kontakter har bara
 * den. Läser vi bara kolumnen missar vi dem.
 */
function websiteOf(row: ContactRow): string | null {
    if (row.website) return row.website;
    const cw = row.custom?.website;
    return typeof cw === 'string' ? cw : null;
}

/** "https://www.Foo.se/kontakt" -> "foo.se". Tom sträng om det inte är en domän. */
export function toDomain(raw: string | null | undefined): string {
    if (!raw) return '';
    const h = raw.trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(h)) return '';
    if (NOT_OWN_SITE.some(p => h.includes(p))) return '';
    return h;
}

function isStale(custom: Record<string, unknown> | null, afterDays: number): boolean {
    const prev = custom?.site_health as StoredSiteHealth | undefined;
    if (!prev?.checked_at) return true;
    const age = Date.now() - new Date(prev.checked_at).getTime();
    return !Number.isFinite(age) || age > afterDays * 24 * 60 * 60 * 1000;
}

export async function scanContactSites(opts: {
    limit?: number;
    recheckAfterDays?: number;
    dryRun?: boolean;
} = {}): Promise<ScanSummary> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const recheckAfterDays = opts.recheckAfterDays ?? RECHECK_AFTER_DAYS;

    const { data, error } = await supabase
        .from('contacts')
        .select('id, company, website, custom')
        .or('website.not.is.null,custom->>website.not.is.null')
        .limit(limit);

    if (error) throw new Error(`Kunde inte läsa kontakter: ${error.message}`);
    const rows = (data ?? []) as ContactRow[];

    const summary: ScanSummary = {
        scanned: 0, skipped: 0, sellable: 0, inconclusive: 0, ok: 0,
        write_errors: 0, by_verdict: {}, leads: [],
    };

    // En domän kan sitta på flera kontakter — kolla den en gång.
    const byDomain = new Map<string, ContactRow[]>();
    for (const row of rows) {
        const domain = toDomain(websiteOf(row));
        if (!domain || !isStale(row.custom, recheckAfterDays)) { summary.skipped++; continue; }
        const bucket = byDomain.get(domain);
        if (bucket) bucket.push(row); else byDomain.set(domain, [row]);
    }

    if (byDomain.size === 0) return summary;

    // Sex i stället för tolv: den första körningen triggade rate limiting
    // hos Cloudflare och flaggade friska sajter som döda.
    const results = await checkSites([...byDomain.keys()], 6);
    const checked_at = new Date().toISOString();

    for (const result of results) {
        const targets = byDomain.get(result.domain) ?? [];
        summary.by_verdict[result.verdict] = (summary.by_verdict[result.verdict] ?? 0) + 1;
        if (result.verdict === 'OK') summary.ok++;
        if (result.verdict === 'INCONCLUSIVE') summary.inconclusive++;

        for (const row of targets) {
            summary.scanned++;
            if (result.sellable) {
                summary.sellable++;
                summary.leads.push({
                    contact_id: row.id, company: row.company, domain: result.domain,
                    verdict: result.verdict, evidence: result.evidence,
                });
            }
            if (opts.dryRun) continue;
            if (!(await persist(row, result, checked_at))) summary.write_errors++;
        }
    }

    logger.info('siteHealth',
        `Sajtskanning klar: ${summary.scanned} kontrollerade, ${summary.sellable} säljbara, ` +
        `${summary.inconclusive} osäkra${opts.dryRun ? ' (dryRun)' : ''}`);

    return summary;
}

async function persist(row: ContactRow, result: SiteHealth, checked_at: string): Promise<boolean> {
    const stored: StoredSiteHealth = {
        verdict: result.verdict,
        sellable: result.sellable,
        evidence: result.evidence,
        ...(result.finalUrl ? { final_url: result.finalUrl } : {}),
        checked_at,
    };
    const { error } = await supabase
        .from('contacts')
        .update({
            custom: { ...(row.custom ?? {}), site_health: stored },
            updated_at: checked_at,
        })
        .eq('id', row.id);

    if (error) {
        logger.error('siteHealth', `Kunde inte spara sajthälsa för ${row.id}: ${error.message}`);
        return false;
    }
    return true;
}

/** Kontakter som redan har en säljbar sajthälsa lagrad. */
export async function listSiteHealthLeads(limit = 100): Promise<ScanLead[]> {
    const { data, error } = await supabase
        .from('contacts')
        .select('id, company, website, custom')
        .or('website.not.is.null,custom->>website.not.is.null')
        .limit(1000);
    if (error) throw new Error(`Kunde inte läsa kontakter: ${error.message}`);

    return ((data ?? []) as ContactRow[])
        .flatMap(row => {
            const sh = row.custom?.site_health as StoredSiteHealth | undefined;
            if (!sh?.sellable) return [];
            return [{
                contact_id: row.id, company: row.company, domain: toDomain(websiteOf(row)),
                verdict: sh.verdict, evidence: sh.evidence,
            }];
        })
        .slice(0, limit);
}


// ---------------------------------------------------------------------------
// Grind vid intaget
// ---------------------------------------------------------------------------

/**
 * Verdikt som betyder "företaget har en fungerande sajt" — alltså inget lead
 * för det här erbjudandet. MOVED räknas hit: de HAR en sajt, vi har bara fel
 * adress på den.
 */
const HEALTHY: ReadonlySet<string> = new Set<Verdict>(['OK', 'MOVED']);

export type GateDecision =
    | { action: 'create'; site_health?: StoredSiteHealth; note?: string }
    | { action: 'skip'; site_health: StoredSiteHealth };

/**
 * Avgör om ett upptäckt företag ska bli ett kort.
 *
 * Grundregeln: släng bara det vi VET är friskt. Allt annat får passera.
 * Att slänga på okunskap är det dyra felet — då försvinner leads tyst.
 *
 * Därför skapas kortet ändå vid INCONCLUSIVE (WAF-blockering), och vid
 * avsaknad av adress. Kör grinden från Render och en tredjedel av de friska
 * sajterna blir INCONCLUSIVE; grinden gallrar då sämre men tappar ingenting.
 */
export async function gateOnSiteHealth(website: string | null | undefined): Promise<GateDecision> {
    const domain = toDomain(website);
    if (!domain) {
        return { action: 'create', note: 'Ingen egen domän att kontrollera — kortet skapas ogallrat.' };
    }

    let result: SiteHealth;
    try {
        result = await checkSite(domain);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('siteHealth', `Grinden kunde inte kontrollera ${domain}: ${message}`);
        return { action: 'create', note: `Kontrollen kraschade (${message}) — kortet skapas ogallrat.` };
    }

    const stored: StoredSiteHealth = {
        verdict: result.verdict,
        sellable: result.sellable,
        evidence: result.evidence,
        ...(result.finalUrl ? { final_url: result.finalUrl } : {}),
        checked_at: new Date().toISOString(),
    };

    if (HEALTHY.has(result.verdict)) return { action: 'skip', site_health: stored };

    if (result.verdict === 'INCONCLUSIVE') {
        return {
            action: 'create', site_health: stored,
            note: 'Sajten gick inte att bedöma (blockerad) — kortet skapas, kontrollera manuellt.',
        };
    }

    return { action: 'create', site_health: stored };
}
