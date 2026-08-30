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
