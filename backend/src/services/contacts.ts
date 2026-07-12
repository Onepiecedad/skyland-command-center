/**
 * Contacts service (SCC-22 / SCC-23, F1: CRM-kärnan)
 *
 * Turns an incoming lead payload into a normalized `contacts` row and upserts
 * it idempotently on `dedupe_key`. The activity log in routes/leads.ts is kept
 * untouched as an audit event — a contact is the queryable entity on top of it.
 *
 * The mapping/merge logic is split into PURE functions (deriveContactFromLead,
 * mergeContactFields) so it can be unit-tested without a database — that mapping
 * is the risk area when SCC-23 touches the live intake flow.
 */

import { supabase } from './supabase';
import { logger } from './logger';

// Shape of the intake payload (mirrors leadIntakeSchema in routes/leads.ts).
export interface LeadPayload {
    source: 'void_form' | 'voice_call';
    session_uuid?: string | null;
    prospect_id?: string | null;
    name?: string | null;
    email?: string | null;
    company?: string | null;
    website?: string | null;
    phone?: string | null;
    message?: string | null;
    score?: number | null;
    summary?: string | null;
    extracted?: Record<string, unknown> | null;
}

export interface ContactRow {
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    website: string | null;
    status: 'new' | 'working' | 'qualified' | 'won' | 'lost';
    source: string;
    dedupe_key: string;
    custom: Record<string, unknown>;
}

/** Empty strings and whitespace collapse to null so we don't store "". */
function clean(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
}

/**
 * PURE. Map a lead payload + its dedupe key to a normalized contact row.
 * No DB access — safe to unit test.
 */
export function deriveContactFromLead(lead: LeadPayload, dedupeKey: string): ContactRow {
    const custom: Record<string, unknown> = {};
    if (clean(lead.message)) custom.message = clean(lead.message);
    if (clean(lead.summary)) custom.summary = clean(lead.summary);
    if (typeof lead.score === 'number') custom.score = lead.score;
    if (lead.extracted && typeof lead.extracted === 'object') custom.extracted = lead.extracted;
    if (clean(lead.session_uuid)) custom.session_uuid = clean(lead.session_uuid);

    return {
        name: clean(lead.name),
        email: clean(lead.email),
        phone: clean(lead.phone),
        company: clean(lead.company),
        website: clean(lead.website),
        status: 'new',
        source: lead.source === 'voice_call' ? 'voice_call' : 'void_form',
        dedupe_key: dedupeKey,
        custom,
    };
}

/**
 * PURE. Merge an incoming contact row onto an existing one: only overwrite a
 * field when the incoming value is non-null, so a sparse follow-up callback
 * never wipes data we already have. `custom` is shallow-merged.
 */
export function mergeContactFields(
    existing: Partial<ContactRow>,
    incoming: ContactRow
): ContactRow {
    const pick = (a: string | null, b: string | null | undefined): string | null =>
        a !== null && a !== undefined ? a : b ?? null;

    return {
        name: pick(incoming.name, existing.name),
        email: pick(incoming.email, existing.email),
        phone: pick(incoming.phone, existing.phone),
        company: pick(incoming.company, existing.company),
        website: pick(incoming.website, existing.website),
        // Never downgrade a status the operator/pipeline has already advanced.
        status: existing.status && existing.status !== 'new' ? existing.status : incoming.status,
        source: existing.source ?? incoming.source,
        dedupe_key: incoming.dedupe_key,
        custom: { ...(existing.custom ?? {}), ...incoming.custom },
    };
}

/**
 * Upsert a contact from a lead. Idempotent on dedupe_key: a lead arriving twice
 * updates one contact rather than creating two. Returns the contact id, or null
 * on failure (intake must not 500 just because the CRM write hiccuped).
 */
export async function upsertContactFromLead(
    lead: LeadPayload,
    dedupeKey: string
): Promise<{ id: string; created: boolean } | null> {
    const derived = deriveContactFromLead(lead, dedupeKey);

    try {
        const { data: existing } = await supabase
            .from('contacts')
            .select('id, name, email, phone, company, website, status, source, custom')
            .eq('dedupe_key', dedupeKey)
            .limit(1)
            .maybeSingle();

        if (existing) {
            const merged = mergeContactFields(existing as Partial<ContactRow>, derived);
            const { error } = await supabase
                .from('contacts')
                .update({ ...merged, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            if (error) {
                logger.warn('contacts', `Contact update failed: ${error.message}`, { dedupeKey });
                return null;
            }
            return { id: existing.id as string, created: false };
        }

        const { data, error } = await supabase
            .from('contacts')
            .insert(derived)
            .select('id')
            .single();
        if (error || !data) {
            logger.warn('contacts', `Contact insert failed: ${error?.message}`, { dedupeKey });
            return null;
        }
        return { id: data.id as string, created: true };
    } catch (err) {
        logger.warn('contacts', `upsertContactFromLead threw: ${err instanceof Error ? err.message : 'unknown'}`, { dedupeKey });
        return null;
    }
}
