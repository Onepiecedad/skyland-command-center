/**
 * Operatörslarm (plan 3.1, sista biten) — "berätta för Joakim NU".
 *
 * Ett intresserat svar är färskvara. Digesten kommer 07:00 nästa morgon och
 * Skuggvecka kräver att man tittar; ingen av dem duger när en klinik just
 * skrivit "ja, berätta mer".
 *
 * Två vägar, båda best-effort, ingen får kasta:
 *  1. WhatsApp via Alex — SCC köar en `claw:notify`-uppgift som pollern på
 *     VPS:en hämtar via /claw/pending och låter gatewayen leverera. Render når
 *     inte tailnetet, så pull-vägen är den enda som finns.
 *  2. Mejl via Resend till EMAIL_FORWARD_TO — samma väg som poller-vakten och
 *     digesten. Går alltid fram, även om gatewayen sover. Skickas direkt via
 *     providern (internt larm, inte outreach: rör inte dagsbudget eller
 *     OUTBOUND_ENABLED).
 *
 * Dedupe på `dedupeKey`: samma händelse larmar en gång per dygn, så ett
 * mejlsvar som klassas om inte spammar telefonen.
 */

import { supabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';
import { getEmailProvider } from './email';
import { dispatchTask } from './taskService';

export interface OperatorAlert {
    /** Kort etikett, t.ex. 'reply.interested' — syns i activities. */
    kind: string;
    /** Rubrikrad. Blir mejlets ämne och första raden i WhatsApp-meddelandet. */
    title: string;
    /** Brödtext, ren text. */
    body: string;
    contactId?: string | null;
    customerId?: string | null;
    /** Samma nyckel = larma bara en gång per dygn. */
    dedupeKey: string;
    /** Länk att öppna, t.ex. kortet i SCC. */
    url?: string | null;
}

export interface AlertResult {
    sent: boolean;
    whatsapp: 'queued' | 'skipped' | 'failed';
    email: 'sent' | 'skipped' | 'failed';
    deduped: boolean;
}

const DEDUPE_WINDOW_MS = 24 * 3600_000;

/** Har vi redan larmat om det här det senaste dygnet? */
async function alreadyAlerted(dedupeKey: string): Promise<boolean> {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const { data, error } = await supabase
        .from('activities')
        .select('id')
        .eq('action', 'operator.alert')
        .contains('details', { dedupe_key: dedupeKey })
        .gte('created_at', since)
        .limit(1);
    if (error) {
        // Kan vi inte kolla dedupe larmar vi hellre två gånger än noll.
        logger.warn('operatorAlert', `dedupe-koll misslyckades: ${error.message}`);
        return false;
    }
    return (data ?? []).length > 0;
}

/** Köar WhatsApp-larmet som en claw:notify-uppgift för pollern. */
async function queueWhatsapp(a: OperatorAlert, text: string): Promise<'queued' | 'skipped' | 'failed'> {
    if (!config.OPERATOR_WHATSAPP_TO) return 'skipped';
    try {
        const { data: task, error } = await supabase.from('tasks').insert({
            customer_id: a.customerId ?? null,
            title: a.title,
            description: 'Operatörslarm — skickas till Joakim på WhatsApp av Alex.',
            executor: 'claw:notify',
            status: 'created',
            priority: 'high',
            input: { channel: 'whatsapp', to: config.OPERATOR_WHATSAPP_TO, text, kind: a.kind, contact_id: a.contactId ?? null },
        }).select('id').single();
        if (error || !task) {
            logger.warn('operatorAlert', `kunde inte skapa notify-uppgift: ${error?.message ?? 'okänt fel'}`);
            return 'failed';
        }
        const res = await dispatchTask(task.id as string, 'system:operator-alert');
        if (!res.success) {
            logger.warn('operatorAlert', `kunde inte köa notify-uppgift: ${res.error ?? 'okänt fel'}`);
            return 'failed';
        }
        return 'queued';
    } catch (err) {
        logger.warn('operatorAlert', `notify-uppgift kastade: ${err instanceof Error ? err.message : err}`);
        return 'failed';
    }
}

/** Mejlar larmet direkt via providern (internt, inte outreach). */
async function mailAlert(a: OperatorAlert, text: string): Promise<'sent' | 'skipped' | 'failed'> {
    if (!config.EMAIL_FORWARD_TO) return 'skipped';
    try {
        await getEmailProvider().send({ to: config.EMAIL_FORWARD_TO, subject: a.title, text });
        return 'sent';
    } catch (err) {
        logger.warn('operatorAlert', `kunde inte mejla larm: ${err instanceof Error ? err.message : err}`);
        return 'failed';
    }
}

export function formatAlert(a: OperatorAlert): string {
    return [a.title, '', a.body, a.url ? `\n${a.url}` : ''].join('\n').trim();
}

/** Larma operatören. Kastar aldrig — anropande flöde får aldrig falla på ett larm. */
export async function alertOperator(a: OperatorAlert): Promise<AlertResult> {
    const result: AlertResult = { sent: false, whatsapp: 'skipped', email: 'skipped', deduped: false };

    if (!config.OPERATOR_ALERTS_ENABLED) return result;

    if (await alreadyAlerted(a.dedupeKey)) {
        result.deduped = true;
        logger.info('operatorAlert', `hoppar över dubblett (${a.dedupeKey})`);
        return result;
    }

    const text = formatAlert(a);
    const [whatsapp, email] = await Promise.all([queueWhatsapp(a, text), mailAlert(a, text)]);
    result.whatsapp = whatsapp;
    result.email = email;
    result.sent = whatsapp === 'queued' || email === 'sent';

    try {
        await supabase.from('activities').insert({
            customer_id: a.customerId ?? null, agent: 'system:operator-alert', event_type: 'message',
            action: 'operator.alert', severity: result.sent ? 'info' : 'warn',
            details: {
                dedupe_key: a.dedupeKey, kind: a.kind, title: a.title,
                contact_id: a.contactId ?? null, whatsapp, email,
            },
        });
    } catch (err) {
        logger.warn('operatorAlert', `kunde inte logga larmet: ${err instanceof Error ? err.message : err}`);
    }

    logger.info('operatorAlert', `${a.kind}: whatsapp=${whatsapp}, mejl=${email}`);
    return result;
}
