/**
 * Kontakt-merge (GHL-härledd SCC-41) — GHL förlorar tyst betalnings-/aktivitetsdata
 * vid merge. SCC bevarar ALLT: opportunities, bokningar, enrollments, meddelanden och
 * aktiviteter flyttas från dubbletten till primären, taggar/custom slås ihop, och
 * merge loggas i activities (audit). Dubbletten raderas sist.
 */

import { supabase } from './supabase';
import { logger } from './logger';

interface ContactRow {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    custom: Record<string, unknown> | null;
    tags: string[] | null;
    customer_id: string | null;
}

/** Flytta jsonb-refererade rader (messages/activities) från dup → primär. */
async function repointJsonbRefs(
    table: 'messages' | 'activities', jsonbCol: 'metadata' | 'details',
    dupId: string, primaryId: string
): Promise<number> {
    const { data } = await supabase.from(table).select(`id, ${jsonbCol}`).contains(jsonbCol, { contact_id: dupId });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
        const obj = { ...(r[jsonbCol] as Record<string, unknown>), contact_id: primaryId };
        await supabase.from(table).update({ [jsonbCol]: obj }).eq('id', r.id as string);
    }
    return rows.length;
}

export interface MergeResult {
    primary_id: string;
    moved: { opportunities: number; bookings: number; enrollments: number; messages: number; activities: number };
}

export async function mergeContacts(primaryId: string, dupId: string): Promise<MergeResult> {
    if (primaryId === dupId) throw new Error('Kan inte merga en kontakt med sig själv');

    const [{ data: p }, { data: d }] = await Promise.all([
        supabase.from('contacts').select('id,name,email,phone,custom,tags,customer_id').eq('id', primaryId).maybeSingle(),
        supabase.from('contacts').select('id,name,email,phone,custom,tags,customer_id').eq('id', dupId).maybeSingle(),
    ]);
    const primary = p as ContactRow | null;
    const dup = d as ContactRow | null;
    if (!primary) throw new Error(`Primär kontakt ${primaryId} saknas`);
    if (!dup) throw new Error(`Dubblett ${dupId} saknas`);

    // 1. Flytta FK-refererade entiteter (contact_id-kolumn)
    const oppRes = await supabase.from('opportunities').update({ contact_id: primaryId }).eq('contact_id', dupId).select('id');
    const bookRes = await supabase.from('bookings').update({ contact_id: primaryId }).eq('contact_id', dupId).select('id');
    // Enrollments: unik-aktiv-spärr kan blocka om båda är aktiva i samma sekvens —
    // flytta de som går, dubblettens ev. kvarvarande försvinner med den (den är en dubblett).
    const enrRes = await supabase.from('sequence_enrollments').update({ contact_id: primaryId }).eq('contact_id', dupId).select('id');

    // 2. Flytta jsonb-refererade rader
    const msgN = await repointJsonbRefs('messages', 'metadata', dupId, primaryId);
    const actN = await repointJsonbRefs('activities', 'details', dupId, primaryId);

    // 3. Slå ihop taggar (union) + custom (primär vinner, fyll luckor från dup) + fält
    const tags = Array.from(new Set([...(primary.tags ?? []), ...(dup.tags ?? [])]));
    const custom = { ...(dup.custom ?? {}), ...(primary.custom ?? {}) };
    await supabase.from('contacts').update({
        tags,
        custom,
        email: primary.email ?? dup.email,
        phone: primary.phone ?? dup.phone,
        name: primary.name ?? dup.name,
    }).eq('id', primaryId);

    // 4. Audit-logg på primären (ingen tyst dataförlust)
    await supabase.from('activities').insert({
        customer_id: primary.customer_id ?? null, agent: 'operator', event_type: 'contact',
        action: 'contact.merged', severity: 'info',
        details: {
            primary_id: primaryId, merged_from: dupId, merged_name: dup.name,
            moved: { opportunities: (oppRes.data ?? []).length, bookings: (bookRes.data ?? []).length, enrollments: (enrRes.data ?? []).length, messages: msgN, activities: actN },
        },
    });

    // 5. Radera dubbletten sist (all data är flyttad)
    await supabase.from('contacts').delete().eq('id', dupId);

    logger.info('contactMerge', `mergade ${dupId} → ${primaryId}`);
    return {
        primary_id: primaryId,
        moved: {
            opportunities: (oppRes.data ?? []).length, bookings: (bookRes.data ?? []).length,
            enrollments: (enrRes.data ?? []).length, messages: msgN, activities: actN,
        },
    };
}
