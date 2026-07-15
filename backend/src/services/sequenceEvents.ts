/**
 * Sekvens-events (SCC-42) — kopplar SCC-händelser till sekvensmotorn.
 *
 * - Triggers: en händelse (stage ändrad, kontakt skapad, bokning gjord, tagg satt)
 *   skriver in kontakten i matchande aktiva sekvenser.
 * - Exit: en händelse (svar inkommet, bokning gjord) avslutar aktiva enrollments
 *   vars sekvens har händelsen i `exit_on`.
 *
 * Alla funktioner är best-effort och kastar aldrig uppåt — de anropas fire-and-forget
 * från befintliga endpoints och får aldrig fälla huvudflödet.
 */

import { supabase } from './supabase';
import { logger } from './logger';

type TriggerType =
    | 'contact_created' | 'opportunity_created' | 'stage_changed'
    | 'booking_created' | 'tag_added';

/** Skriv in en kontakt i en sekvens. Unik-aktiv-spärren hanterar dedup. */
export async function enrollContact(
    sequenceId: string, contactId: string, opportunityId?: string | null
): Promise<{ enrolled: boolean; reason?: string }> {
    const { error } = await supabase.from('sequence_enrollments').insert({
        sequence_id: sequenceId,
        contact_id: contactId,
        opportunity_id: opportunityId ?? null,
        next_run_at: new Date().toISOString(),
    });
    if (error) {
        // 23505 = unique_violation → redan aktiv enrollment, inte ett fel
        if ((error as { code?: string }).code === '23505') return { enrolled: false, reason: 'already_active' };
        logger.error('sequenceEvents', `enrollContact misslyckades: ${error.message}`);
        return { enrolled: false, reason: error.message };
    }
    return { enrolled: true };
}

/**
 * En trigger-händelse inträffade → skriv in kontakten i alla aktiva sekvenser
 * vars trigger matchar. `match` jämförs mot sekvensens trigger_config (t.ex.
 * { stage_id } för stage_changed).
 */
export async function fireTrigger(
    trigger: TriggerType,
    contactId: string,
    match: Record<string, string | null> = {},
    opportunityId?: string | null
): Promise<void> {
    try {
        const { data, error } = await supabase
            .from('sequences')
            .select('id, trigger_config')
            .eq('status', 'active')
            .eq('trigger_type', trigger);
        if (error) { logger.error('sequenceEvents', `fireTrigger-query: ${error.message}`); return; }

        for (const seq of (data ?? []) as { id: string; trigger_config: Record<string, unknown> }[]) {
            // Alla nycklar i trigger_config måste matcha inkommande `match`
            const cfg = seq.trigger_config ?? {};
            const ok = Object.keys(cfg).every(k => String(cfg[k]) === String(match[k] ?? ''));
            if (!ok) continue;
            await enrollContact(seq.id, contactId, opportunityId);
        }
    } catch (err) {
        logger.error('sequenceEvents', `fireTrigger-fel: ${err instanceof Error ? err.message : err}`);
    }
}

/**
 * En exit-händelse inträffade → avsluta aktiva enrollments för kontakten vars
 * sekvens listar händelsen i `exit_on` (t.ex. "reply_received").
 */
export async function fireExit(event: string, contactId: string): Promise<void> {
    try {
        const { data, error } = await supabase
            .from('sequences')
            .select('id')
            .eq('status', 'active')
            .contains('exit_on', [event]);
        if (error) { logger.error('sequenceEvents', `fireExit-query: ${error.message}`); return; }
        const ids = (data ?? []).map(s => (s as { id: string }).id);
        if (!ids.length) return;

        const { error: uErr } = await supabase
            .from('sequence_enrollments')
            .update({
                status: 'exited', exit_reason: event,
                completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            })
            .eq('contact_id', contactId)
            .eq('status', 'active')
            .in('sequence_id', ids);
        if (uErr) logger.error('sequenceEvents', `fireExit-update: ${uErr.message}`);
    } catch (err) {
        logger.error('sequenceEvents', `fireExit-fel: ${err instanceof Error ? err.message : err}`);
    }
}

// Bekväma alias för de vanligaste händelserna
export const onStageChanged = (contactId: string, pipelineId: string | null, stageId: string, oppId?: string | null) =>
    fireTrigger('stage_changed', contactId, { stage_id: stageId, pipeline_id: pipelineId ?? '' }, oppId);
export const onReplyReceived = (contactId: string) => fireExit('reply_received', contactId);
export const onBookingCreated = (contactId: string, oppId?: string | null) =>
    Promise.all([fireTrigger('booking_created', contactId, {}, oppId), fireExit('booking_created', contactId)]).then(() => undefined);
