/**
 * Comms-executor (SCC-30) — kör GODKÄNDA utskicks-tasks.
 * Säkerhet: kill switch (OUTBOUND_ENABLED) + daglig volymbudget (OUTBOUND_DAILY_LIMIT).
 * Allt loggas: message (direction=outbound) + activity per utskick.
 */

import { supabase } from './supabase';
import { config } from '../config';
import { getEmailProvider } from './email';

export interface CommsResult {
    success: boolean;
    output?: Record<string, unknown>;
    error?: string;
}

interface EmailTaskInput {
    contact_id?: string;
    subject?: string;
    body?: string;
    reply_to?: string;
}

async function countOutboundToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'outbound')
        .gte('created_at', startOfDay.toISOString());
    if (error) throw new Error(`Kunde inte räkna dagens utskick: ${error.message}`);
    return count ?? 0;
}

export async function executeCommsEmail(
    task: Record<string, unknown>,
    runId: string
): Promise<CommsResult> {
    // 1. Kill switch — hård stopp, oavsett godkännande
    if (!config.OUTBOUND_ENABLED) {
        return { success: false, error: 'Utskick avstängda (OUTBOUND_ENABLED=false). Se SCC-35-checklistan innan aktivering.' };
    }

    // 2. Daglig budget
    const sentToday = await countOutboundToday();
    if (sentToday >= config.OUTBOUND_DAILY_LIMIT) {
        return { success: false, error: `Daglig utskicksbudget nådd (${sentToday}/${config.OUTBOUND_DAILY_LIMIT}). Se volymtrappan i docs/EMAIL_INFRA.md.` };
    }

    // 3. Validera input + slå upp kontakt
    const input = (task.input ?? {}) as EmailTaskInput;
    if (!input.contact_id) return { success: false, error: 'task.input.contact_id krävs' };
    if (!input.subject || !input.body) return { success: false, error: 'task.input.subject och body krävs' };

    const { data: contact, error: cErr } = await supabase
        .from('contacts')
        .select('id, name, email, custom, customer_id')
        .eq('id', input.contact_id)
        .maybeSingle();
    if (cErr) return { success: false, error: cErr.message };
    if (!contact) return { success: false, error: `Kontakt ${input.contact_id} hittades inte` };

    const custom = (contact.custom ?? {}) as Record<string, unknown>;
    const to = contact.email || (typeof custom.email === 'string' ? custom.email : null);
    if (!to) return { success: false, error: `Kontakten "${contact.name}" saknar e-postadress` };

    // 4. Skicka
    let providerMessageId: string;
    try {
        const provider = getEmailProvider();
        const result = await provider.send({
            to,
            subject: input.subject,
            text: input.body,
            replyTo: input.reply_to,
        });
        providerMessageId = result.providerMessageId;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt utskicksfel';
        // Logga misslyckat försök som message så det syns i kontaktens tråd
        await supabase.from('messages').insert({
            customer_id: contact.customer_id ?? null,
            role: 'assistant',
            channel: 'email',
            direction: 'outbound',
            status: 'failed',
            content: `[MISSLYCKAT UTSKICK] ${input.subject}\n\n${input.body}`,
            metadata: { contact_id: contact.id, task_id: task.id, run_id: runId, to, error: message },
        });
        return { success: false, error: message };
    }

    // 5. Logga skickat message (unified inbox) — activity loggas av dispatchern (run_completed)
    const { data: msg, error: mErr } = await supabase
        .from('messages')
        .insert({
            customer_id: contact.customer_id ?? null,
            role: 'assistant',
            channel: 'email',
            direction: 'outbound',
            status: 'sent',
            content: `${input.subject}\n\n${input.body}`,
            metadata: { contact_id: contact.id, task_id: task.id, run_id: runId, to },
            provider_message_id: providerMessageId,
        })
        .select('id')
        .single();
    if (mErr) {
        // Mailet är skickat men loggningen föll — hög severity, får inte försvinna tyst
        await supabase.from('activities').insert({
            customer_id: contact.customer_id ?? null,
            agent: 'system:comms',
            event_type: 'message',
            action: 'outbound_log_failed',
            severity: 'error',
            details: { contact_id: contact.id, provider_message_id: providerMessageId, error: mErr.message },
        });
    }

    return {
        success: true,
        output: {
            message_id: msg?.id ?? null,
            provider_message_id: providerMessageId,
            to,
            contact_name: contact.name,
            sent_today: sentToday + 1,
            daily_limit: config.OUTBOUND_DAILY_LIMIT,
        },
    };
}
