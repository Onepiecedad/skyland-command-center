/**
 * Outreach-grindar (SCC-46, databasreaktivering) — delas av sekvensmotorn och comms.
 *
 * - outboundMode(): 'off' | 'shadow' | 'live'. Shadow loggar exakt vad som SKULLE
 *   skickats (messages.status='shadow') utan att röra någon provider, så en
 *   skuggvecka kan jämföras mot operatörens eget omdöme innan autosend slås på.
 *   Live kräver fortfarande OUTBOUND_ENABLED=true — OUTBOUND_MODE kan bara
 *   göra systemet FÖRSIKTIGARE, aldrig öppna det.
 * - splitDm(): kortets custom.dm_hook (öppnare + "---" + uppföljning, som
 *   dm_pipeline sparar det) → { opener, followup }.
 * - isSuppressed(): suppressionslistan (bounces, avböjda, befintliga kunder).
 *   Träff på exakt adress/nummer eller på hel domän.
 */

import { supabase } from './supabase';
import { config } from '../config';

export type OutboundMode = 'off' | 'shadow' | 'live';

/** sequences.outbound_policy. 'outreach' lyder kill switch/skugga/dagsbudget;
 *  'transactional' (bokningspåminnelser o.dyl. — mottagaren har själv bett om
 *  kontakten) går ut ändå, grindat bara av TRANSACTIONAL_OUTBOUND_ENABLED. */
export type OutboundPolicy = 'outreach' | 'transactional';

export function normalizePolicy(v: unknown): OutboundPolicy {
    return v === 'transactional' ? 'transactional' : 'outreach';
}

export function outboundMode(policy: OutboundPolicy = 'outreach'): OutboundMode {
    if (policy === 'transactional') {
        return config.TRANSACTIONAL_OUTBOUND_ENABLED === false ? 'off' : 'live';
    }
    if (config.OUTBOUND_MODE === 'shadow') return 'shadow';
    return config.OUTBOUND_ENABLED ? 'live' : 'off';
}

/** Suppressionsorsaker som INTE ska stoppa transaktionell post: att någon är
 *  befintlig kund är ett skäl att slippa kallmejl, inte att slippa sin egen
 *  bokningsbekräftelse. Studsar/klagomål/avböjda stoppar alltid. */
const TRANSACTIONAL_IGNORED_REASONS = new Set(['existing_customer']);

export function suppressionApplies(hit: { reason: string | null } | null, policy: OutboundPolicy): boolean {
    if (!hit) return false;
    if (policy === 'transactional' && hit.reason && TRANSACTIONAL_IGNORED_REASONS.has(hit.reason)) return false;
    return true;
}

export interface DmParts {
    opener: string;
    followup: string;
}

/** Dela kortets dm_hook på en rad som bara är "---". Saknas avdelare = allt är öppnare. */
export function splitDm(custom: Record<string, unknown> | null | undefined): DmParts | null {
    const raw = custom && typeof custom.dm_hook === 'string' ? custom.dm_hook : '';
    if (!raw.trim()) return null;
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const idx = lines.findIndex(l => l.trim() === '---');
    if (idx === -1) return { opener: raw.trim(), followup: '' };
    return {
        opener: lines.slice(0, idx).join('\n').trim(),
        followup: lines.slice(idx + 1).join('\n').trim(),
    };
}

export type SuppressionKind = 'email' | 'phone' | 'domain';

export function normalizeSuppressionValue(kind: SuppressionKind, value: string): string {
    const v = value.trim().toLowerCase();
    if (kind === 'phone') return v.replace(/[\s\-()]/g, '');
    return v;
}

export function domainOf(email: string): string | null {
    const at = email.lastIndexOf('@');
    return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

export interface SuppressionHit {
    kind: SuppressionKind;
    value: string;
    reason: string | null;
}

/** Null = inte spärrad. Fel mot DB räknas som spärrad (fail closed) — hellre
 *  ett hoppat mejl än ett mejl till någon som bett att slippa. */
export async function isSuppressed(kind: 'email' | 'phone', value: string): Promise<SuppressionHit | null> {
    const norm = normalizeSuppressionValue(kind, value);
    const candidates: { kind: SuppressionKind; value: string }[] = [{ kind, value: norm }];
    if (kind === 'email') {
        const d = domainOf(norm);
        if (d) candidates.push({ kind: 'domain', value: d });
    }
    const or = candidates.map(c => `and(kind.eq.${c.kind},value.eq.${c.value})`).join(',');
    const { data, error } = await supabase
        .from('suppression_list')
        .select('kind, value, reason')
        .or(or)
        .limit(1);
    if (error) return { kind, value: norm, reason: `db_error: ${error.message}` };
    const row = (data ?? [])[0] as SuppressionHit | undefined;
    return row ?? null;
}

export async function addSuppression(
    kind: SuppressionKind, value: string, reason: string, source: string, contactId?: string | null
): Promise<void> {
    const norm = normalizeSuppressionValue(kind, value);
    if (!norm) return;
    await supabase.from('suppression_list').upsert(
        { kind, value: norm, reason, source, contact_id: contactId ?? null },
        { onConflict: 'kind,value', ignoreDuplicates: true }
    );
}

// ---------------------------------------------------------------------------
// Arbetstidsfönster (plan 2.5) — bara LIVE outreach. Vardagar START–END i
// Stockholm, plus slumpad spridning så en batch inte skickar allt i samma tick.
// ---------------------------------------------------------------------------

const STOCKHOLM = 'Europe/Stockholm';

/** (veckodag 1=mån..7=sön, timme, minut) i Stockholm för en tidpunkt. */
/**
 * Dagens faktiska utskick i EN hink — underlag för dagsbudgeten.
 *
 * Räknas på NÄR MEJLET GICK, inte när raden skapades. För maskinens egna
 * utskick är det samma ögonblick, men ett godkänt skuggmejl behåller sitt
 * `created_at` från dagen utkastet skrevs. Därför såg budgeten noll skickade
 * den 3 sep efter att sju skuggrader från 1 sep klickats iväg — hela den
 * manuella kön gick under radarn. Operatörsvägen saknar kill switch med
 * flit; då måste åtminstone volymtaket gälla för den.
 *
 * Två frågor i stället för en `coalesce`: PostgREST kan inte filtrera på ett
 * uttryck. A = maskinens utskick idag (ingen approved_at), B = operatörens
 * (approved_at idag). Ingen rad kan hamna i båda.
 *
 * Jämförelsen mot metadata->>approved_at är textuell, vilket är korrekt så
 * länge värdet skrivs med toISOString() — UTC, fast bredd, sorterbart.
 *
 * BUDGETEN ÄR INTE GLOBAL (8 sep). Trappan i docs/EMAIL_INFRA.md finns för att
 * värma en avsändardomän, och rykte byggs per domän. Före det här delade Cold
 * Experience och beautykampanjen på samma fem platser, och Gustav-robotens
 * Messenger-svar räknades som kall utkorg fast de varken är mejl eller utkorg.
 * Nu bär varje utskick sin hink i `metadata.budget_key` och räkningen filtrerar
 * på den. Kanalfiltret ligger kvar som andra spärr: rader från spegeln
 * (channel='messenger') kan aldrig hamna i en mejlhink oavsett metadata.
 */
export async function countSentToday(key: string, now: Date = new Date()): Promise<number> {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const startIso = start.toISOString();
    const channel = key.startsWith('email:') ? 'email' : 'sms';

    // Rader skrivna före hinkarna saknar budget_key. De gick alla från
    // EMAIL_FROM, så bara standarddomänen ärver dem — skulle de räknas i varje
    // hink startade en ny domän med någon annans historik. Att fråga två gånger
    // och lägga ihop är avsiktligt i stället för en `or`: mängderna är disjunkta
    // (null respektive exakt nyckeln), och `eq`/`is` är samma filterytor som
    // resten av filen redan vilar på.
    const nycklar: (string | null)[] = key === defaultBudgetKey(channel) ? [key, null] : [key];

    const base = (nyckel: string | null) => {
        const q = supabase.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('direction', 'outbound')
            .eq('channel', channel);
        return nyckel === null
            ? q.is('metadata->>budget_key', null)
            : q.eq('metadata->>budget_key', nyckel);
    };

    const fragor = nycklar.flatMap(nyckel => [
        base(nyckel).eq('status', 'sent').is('metadata->>approved_at', null).gte('created_at', startIso),
        // Operatörens "Skicka nu": sent ELLER queued (claimad, på väg) med
        // approved_at i dag. queued räknas så att platsen är reserverad medan
        // providern anropas — annars kunde två klick dela på sista platsen.
        base(nyckel).in('status', ['sent', 'queued']).gte('metadata->>approved_at', startIso),
    ]);

    let summa = 0;
    for (const svar of await Promise.all(fragor)) {
        if (svar.error) throw new Error(`Kunde inte räkna dagens utskick: ${svar.error.message}`);
        summa += svar.count ?? 0;
    }
    return summa;
}

/**
 * Domändelen av en avsändare. Tål både "a@b.se" och "Namn <a@b.se>".
 * Tom sträng om adressen är obrukbar — anropare får då hinken 'email:okand',
 * som har standardtaket. Att gissa en domän vore värre än att vara tydlig.
 */
export function domainOfAddress(from: string | null | undefined): string {
    const vinkel = /<([^>]+)>/.exec(from ?? '');
    const adress = (vinkel ? vinkel[1] : (from ?? '')).trim();
    const snabel = adress.lastIndexOf('@');
    if (snabel === -1) return '';
    return adress.slice(snabel + 1).trim().toLowerCase().replace(/[>,;\s]+$/, '');
}

/** Hinken ett utskick dras från. Mejl per avsändardomän, SMS för sig. */
export function budgetKey(channel: 'email' | 'sms', from?: string | null): string {
    if (channel === 'sms') return 'sms';
    return `email:${domainOfAddress(from || config.EMAIL_FROM) || 'okand'}`;
}

/** Hinken som gamla rader utan budget_key tillhör. */
export function defaultBudgetKey(channel: 'email' | 'sms'): string {
    return budgetKey(channel, null);
}

/**
 * Taket för en hink. OUTBOUND_DAILY_LIMITS får sätta ett eget värde per nyckel;
 * saknas det gäller OUTBOUND_DAILY_LIMIT. En ny domän ärver alltså den
 * försiktiga siffran tills någon medvetet höjer den, vilket är rätt håll att
 * fela åt.
 */
export function dailyLimitFor(key: string): number {
    const eget = config.OUTBOUND_DAILY_LIMITS?.[key];
    return typeof eget === 'number' ? eget : config.OUTBOUND_DAILY_LIMIT;
}

export function stockholmParts(d: Date): { dow: number; hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: STOCKHOLM, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const dow = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[get('weekday')] ?? 1;
    return { dow, hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

export function insideOutreachWindow(now: Date = new Date()): boolean {
    const { dow, hour } = stockholmParts(now);
    return dow <= 5 && hour >= config.OUTREACH_WINDOW_START_HOUR && hour < config.OUTREACH_WINDOW_END_HOUR;
}

/** Ms till nästa fönsteröppning (nästa vardag START:00 i Stockholm). 0 om vi är inne. */
export function msUntilWindowOpen(now: Date = new Date()): number {
    if (insideOutreachWindow(now)) return 0;
    // Stega minutvis vore dyrt — stega i kvartar tills vi är innanför (max 4 dygn: fre kväll → mån morgon).
    const step = 15 * 60_000;
    for (let t = now.getTime() + step; t <= now.getTime() + 5 * 86_400_000; t += step) {
        const d = new Date(t);
        if (insideOutreachWindow(d)) {
            // Backa till hel kvart som fortfarande är innanför — närmevärde räcker,
            // spridningen läggs ovanpå ändå.
            return t - now.getTime();
        }
    }
    return 0; // borde aldrig hända — hellre skicka än fastna
}

/** Slumpad spridning 0..OUTREACH_JITTER_MINUTES (ms). */
export function outreachJitterMs(rand: () => number = Math.random): number {
    return Math.floor(rand() * config.OUTREACH_JITTER_MINUTES * 60_000);
}
