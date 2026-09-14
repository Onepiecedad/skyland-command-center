/**
 * Sajthälsa: etiketter, sökord och samtalsmallar.
 *
 * Delas av kanban-kortet och detaljpanelen. Ligger här hellre än i
 * PipelineBoard eftersom båda vyerna behöver exakt samma formuleringar — en
 * diagnos som skiljer sig mellan kort och panel är värre än ingen alls.
 */

/**
 * Sajthälsa satt av siteHealthScan (backend). Kortet visade tidigare webb-
 * adressen som en vanlig länk även när domänen var parkerad eller borta —
 * panelen påstod alltså att företaget hade en hemsida när det inte hade det.
 */
export type SiteHealth = { verdict: string; sellable?: boolean; evidence?: string; final_url?: string };

/** Etikett + färg per verdikt. Utelämnade verdikt ritas inte alls. */
export const SITE_HEALTH_LABEL: Record<string, string> = {
    DOMAIN_GONE: 'domänen finns inte',
    PARKED: 'parkerad domän',
    MISDIRECT: 'adressen leder delvis fel',
    DIRECTORY_ONLY: 'katalogsajt i Google-profilen, ingen egen hemsida',
    HIJACKED: 'domänen pekar bort',
    UNREACHABLE: 'gick inte att nå — kontrollera själv',
    ORIGIN_DOWN: 'servern svarar inte',
    SERVER_ERROR: 'serverfel på startsidan',
    CERT_BROKEN: 'säkerhetsvarning för besökare',
    EMPTY: 'tom sida',
    MOVED: 'flyttad — uppdatera adressen',
};

/** Fritext som gör statusen sökbar: "trasig", "parkerad", "hemsida" osv. */
export const SITE_HEALTH_TERMS: Record<string, string> = {
    DOMAIN_GONE: 'trasig webb hemsida domän borta utgången saknas',
    PARKED: 'trasig webb hemsida parkerad domänhandlare till salu',
    MISDIRECT: 'felpekad webb hemsida www adress byggadress delvis',
    DIRECTORY_ONLY: 'katalog katalogsajt ingen egen hemsida google profil skrapad saknar',
    HIJACKED: 'trasig webb hemsida kapad pekar bort redirect',
    UNREACHABLE: 'onåbar webb hemsida oklart kontrollera server nere',
    ORIGIN_DOWN: 'trasig webb hemsida server nere död',
    SERVER_ERROR: 'trasig webb hemsida serverfel',
    CERT_BROKEN: 'trasig webb hemsida certifikat säkerhetsvarning',
    EMPTY: 'trasig webb hemsida tom parkerad',
    MOVED: 'flyttad webb hemsida ny adress uppdatera',
};

export function siteHealthOf(custom: unknown): SiteHealth | null {
    const sh = (custom as Record<string, unknown> | undefined)?.site_health;
    if (!sh || typeof sh !== 'object') return null;
    const v = (sh as SiteHealth).verdict;
    return typeof v === 'string' && v in SITE_HEALTH_LABEL ? (sh as SiteHealth) : null;
}

/** Bara det som faktiskt är en affärssignal — MOVED är städning, inte lead. */
/** Bara det som faktiskt är en affärssignal. MOVED är städning, och
 *  UNREACHABLE vet vi inte — båda hålls utanför leadräkningen. */
export const NOT_A_LEAD = new Set(['MOVED', 'UNREACHABLE', 'MISDIRECT']);


/** Värdnamnet ur en URL, utan www. Tom sträng om det inte går att tolka. */
export function hostOf(raw?: string | null): string {
    if (!raw) return '';
    try {
        const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        return u.hostname.replace(/^www\./, '');
    } catch { return ''; }
}

/**
 * Diagnos och öppningsreplik per verdikt.
 *
 * Medvetet mallar och inte modellgenererat: det kostar inget, blir likadant
 * varje gång, och kan bara säga sådant kontrollen faktiskt verifierat. En
 * genererad mening kan låta bra och ha fel, vilket är precis det vi inte har
 * råd med i ett samtal.
 */
export function callGuide(verdict: string, site: string, target: string):
    { diagnos: string; oppning: string } {
    const t = target || 'en annan sajt';
    switch (verdict) {
        case 'HIJACKED': return {
            diagnos: `Domänen leder till ${t} i stället för till deras egen sajt.`,
            oppning: `Er webbadress ${site} leder till ${t} i dag. Den som söker upp er hamnar där i stället för hos er.`,
        };
        case 'DIRECTORY_ONLY': return {
            diagnos: `Adressen i Google-profilen är katalogsajten ${site}, inte en egen hemsida.`,
            oppning: `Googlar man er och klickar på hemsidelänken hamnar man på ${site}, som inte är er. Jag vet inte om ni känner till det.`,
        };
        case 'PARKED': return {
            diagnos: `Domänen ligger hos en domänhandlare${target ? ` (${target})` : ''} och ser ut att vara till salu.`,
            oppning: `Er domän ${site} ligger hos en domänhandlare. Den ser ut att vara till salu.`,
        };
        case 'DOMAIN_GONE': return {
            diagnos: 'Domänen svarar inte i DNS — den finns inte kvar.',
            oppning: `Er webbadress ${site} slutade fungera, den finns inte kvar i registret.`,
        };
        case 'ORIGIN_DOWN': return {
            diagnos: 'Cloudflare svarar, men når inte servern bakom. Sajten är nere.',
            oppning: 'Er hemsida svarar med ett felmeddelande i stället för att visa sidan.',
        };
        case 'SERVER_ERROR': return {
            diagnos: 'Startsidan svarar med ett serverfel.',
            oppning: 'Er hemsida svarar med ett felmeddelande i stället för att visa sidan.',
        };
        case 'CERT_BROKEN': return {
            diagnos: 'Certifikatet är trasigt. Besökare möts av en röd säkerhetsvarning.',
            oppning: 'Besökare får en röd säkerhetsvarning innan de kommer in på er sida.',
        };
        case 'EMPTY': return {
            diagnos: 'Adressen svarar, men sidan saknar innehåll.',
            oppning: 'Er adress svarar, men sidan är tom.',
        };
        case 'MISDIRECT': return {
            diagnos: `Sajten fungerar, men en variant av adressen leder till ${t}.`,
            oppning: `Skriver man er adress utan www hamnar man på ${t} i stället för på er sida.`,
        };
        case 'MOVED': return {
            diagnos: `De har bytt domännamn till ${t}. Vår adress är gammal.`,
            oppning: `Jag hade er gamla webbadress. Har ni bytt till ${t}?`,
        };
        case 'UNREACHABLE': return {
            // Vi VET inte här. Då ska repliken vara en fråga, inte ett påstående.
            diagnos: 'Gick inte att nå vid två försök. Kan vara nere, kan vara en blockering mot oss.',
            oppning: 'Jag fick inte upp er hemsida när jag försökte. Fungerar den för er?',
        };
        default: return { diagnos: '', oppning: '' };
    }
}

export const NASTA_REPLIK =
    'Vill du att jag gör ett förslag på hur en ny skulle kunna se ut? Kostar inget, du får en länk om ett par dagar.';
