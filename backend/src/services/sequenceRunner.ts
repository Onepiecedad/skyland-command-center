/**
 * Sekvens-runner (SCC-41) — GHL-ersättningens motor.
 *
 * En tick plockar aktiva enrollments vars `next_run_at` passerat, kör stegen
 * (skickar mejl via Resend-servicen, hedrar väntetider, flyttar stages, taggar,
 * grenar, avslutar) och avancerar. Idempotent per steg; allt loggas till
 * sequence_step_runs.
 *
 * Säkerhet: send_email återanvänder samma kill switch (OUTBOUND_ENABLED) + dagliga
 * volymbudget (OUTBOUND_DAILY_LIMIT) som comms.ts.
 */

import { supabase } from './supabase';
import { config } from '../config';
import { getEmailProvider } from './email';
import { getSmsProvider } from './sms';
import { logger } from './logger';

const MAX_STEPS_PER_TICK = 50;      // skydd mot oändliga loopar
const RETRY_BACKOFF_MS = 30 * 60_000; // 30 min vid retriabla fel
const MAX_RETRIES = 5;

interface StepRow {
    id: string;
    sequence_id: string;
    position: number;
    type: string;
    config: Record<string, unknown>;
}
interface SequenceRow {
    id: string;
    status: string;
    exit_on: string[];
}
interface EnrollmentRow {
    id: string;
    sequence_id: string;
    contact_id: string;
    opportunity_id: string | null;
    status: string;
    current_position: number;
    context: Record<string, unknown>;
}
interface ContactRow {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    custom: Record<string, unknown> | null;
    tags: string[] | null;
    customer_id: string | null;
}

type Control = 'advance' | 'wait' | 'exit' | 'retry';
interface StepResult {
    status: 'success' | 'skipped' | 'failed';
    control: Control;
    waitMs?: number;
    detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

function render(text: string, contact: ContactRow): string {
    const first = (contact.name || '').trim().split(/\s+/)[0] || '';
    return String(text || '')
        .replace(/\{\{\s*first_name\s*\}\}/gi, first)
        .replace(/\{\{\s*name\s*\}\}/gi, contact.name || '')
        .replace(/\{\{\s*email\s*\}\}/gi, contact.email || '');
}

function waitMsFromConfig(cfg: Record<string, unknown>): number {
    const n = (k: string) => (typeof cfg[k] === 'number' ? (cfg[k] as number) : 0);
    return n('minutes') * 60_000 + n('hours') * 3_600_000 + n('days') * 86_400_000;
}

async function countOutboundToday(): Promise<number> {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'outbound')
        .gte('created_at', start.toISOString());
    return count ?? 0;
}

/** Har kontakten svarat sedan enrollment startade? (inkommande message) */
async function hasReplied(contactId: string, sinceISO: string): Promise<boolean> {
    const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'inbound')
        .contains('metadata', { contact_id: contactId })
        .gte('created_at', sinceISO);
    return (count ?? 0) > 0;
}

async function logStepRun(
    enrollmentId: string, step: StepRow | null, res: StepResult
): Promise<void> {
    await supabase.from('sequence_step_runs').insert({
        enrollment_id: enrollmentId,
        step_id: step?.id ?? null,
        step_type: step?.type ?? 'complete',
        status: res.status,
        detail: res.detail ?? {},
    });
}

// ---------------------------------------------------------------------------
// Step-executors
// ---------------------------------------------------------------------------

/** Aldrig tyst skip (GHL-härledd SCC-38): logga en synlig activity när ett
 *  utskick hoppas över för att kontakten saknar kanal. */
async function logSkip(contact: ContactRow, seqId: string, channel: string, reason: string): Promise<void> {
    await supabase.from('activities').insert({
        customer_id: contact.customer_id ?? null, agent: 'system:sequence', event_type: 'message',
        action: 'sequence.step.skipped', severity: 'warn',
        details: { contact_id: contact.id, contact_name: contact.name, channel, reason, sequence_id: seqId },
    });
}

async function execSendEmail(step: StepRow, enr: EnrollmentRow, contact: ContactRow): Promise<StepResult> {
    if (!config.OUTBOUND_ENABLED) {
        return { status: 'failed', control: 'retry', detail: { reason: 'OUTBOUND_ENABLED=false' } };
    }
    const sentToday = await countOutboundToday();
    if (sentToday >= config.OUTBOUND_DAILY_LIMIT) {
        return { status: 'failed', control: 'retry', detail: { reason: 'daily_limit', sentToday } };
    }
    const to = contact.email || (typeof contact.custom?.email === 'string' ? (contact.custom!.email as string) : null);
    if (!to) { await logSkip(contact, enr.sequence_id, 'email', 'no_email'); return { status: 'skipped', control: 'advance', detail: { reason: 'no_email' } }; }

    const subject = render(String(step.config.subject ?? ''), contact);
    const body = render(String(step.config.body ?? ''), contact);
    if (!subject.trim() || !body.trim()) {
        await logSkip(contact, enr.sequence_id, 'email', 'empty_email');
        return { status: 'skipped', control: 'advance', detail: { reason: 'empty_email' } };
    }

    try {
        const result = await getEmailProvider().send({
            to, subject, text: body,
            replyTo: typeof step.config.reply_to === 'string' ? step.config.reply_to : undefined,
        });
        await supabase.from('messages').insert({
            customer_id: contact.customer_id ?? null,
            role: 'assistant', channel: 'email', direction: 'outbound', status: 'sent',
            content: `${subject}\n\n${body}`,
            metadata: { contact_id: contact.id, enrollment_id: enr.id, sequence_id: enr.sequence_id, to },
            provider_message_id: result.providerMessageId,
        });
        return { status: 'success', control: 'advance', detail: { to, provider_message_id: result.providerMessageId } };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'okänt utskicksfel';
        return { status: 'failed', control: 'retry', detail: { error: message } };
    }
}

async function execSendSms(step: StepRow, enr: EnrollmentRow, contact: ContactRow): Promise<StepResult> {
    if (!config.OUTBOUND_ENABLED) {
        return { status: 'failed', control: 'retry', detail: { reason: 'OUTBOUND_ENABLED=false' } };
    }
    const sentToday = await countOutboundToday();
    if (sentToday >= config.OUTBOUND_DAILY_LIMIT) {
        return { status: 'failed', control: 'retry', detail: { reason: 'daily_limit', sentToday } };
    }
    const phone = contact.phone || (typeof contact.custom?.phone === 'string' ? (contact.custom!.phone as string) : null);
    if (!phone) {
        await logSkip(contact, enr.sequence_id, 'sms', 'no_phone');
        return { status: 'skipped', control: 'advance', detail: { reason: 'no_phone' } };
    }
    const text = render(String(step.config.text ?? step.config.body ?? ''), contact);
    if (!text.trim()) {
        await logSkip(contact, enr.sequence_id, 'sms', 'empty_sms');
        return { status: 'skipped', control: 'advance', detail: { reason: 'empty_sms' } };
    }
    try {
        const result = await getSmsProvider().send({ to: phone, text });
        await supabase.from('messages').insert({
            customer_id: contact.customer_id ?? null,
            role: 'assistant', channel: 'sms', direction: 'outbound',
            content: text,
            metadata: { contact_id: contact.id, enrollment_id: enr.id, sequence_id: enr.sequence_id, to: phone },
            provider_message_id: result.providerMessageId,
        });
        return { status: 'success', control: 'advance', detail: { to: phone, provider_message_id: result.providerMessageId } };
    } catch (err) {
        return { status: 'failed', control: 'retry', detail: { error: err instanceof Error ? err.message : 'okänt SMS-fel' } };
    }
}

async function execMoveStage(step: StepRow, enr: EnrollmentRow): Promise<StepResult> {
    const stageId = step.config.stage_id as string | undefined;
    const pipelineId = step.config.pipeline_id as string | undefined;
    if (!stageId) return { status: 'skipped', control: 'advance', detail: { reason: 'no_stage_id' } };

    let q = supabase.from('opportunities').update({ stage_id: stageId, updated_at: new Date().toISOString() });
    if (enr.opportunity_id) {
        q = q.eq('id', enr.opportunity_id);
    } else {
        q = q.eq('contact_id', enr.contact_id);
        if (pipelineId) q = q.eq('pipeline_id', pipelineId);
    }
    const { error } = await q;
    if (error) return { status: 'failed', control: 'retry', detail: { error: error.message } };
    return { status: 'success', control: 'advance', detail: { stage_id: stageId } };
}

async function execTag(step: StepRow, contact: ContactRow, add: boolean): Promise<StepResult> {
    const tag = String(step.config.tag ?? '').trim();
    if (!tag) return { status: 'skipped', control: 'advance', detail: { reason: 'no_tag' } };
    const current = Array.isArray(contact.tags) ? contact.tags : [];
    const next = add
        ? Array.from(new Set([...current, tag]))
        : current.filter(t => t !== tag);
    const { error } = await supabase.from('contacts').update({ tags: next }).eq('id', contact.id);
    if (error) return { status: 'failed', control: 'retry', detail: { error: error.message } };
    return { status: 'success', control: 'advance', detail: { tag, add } };
}

async function execBranch(step: StepRow, enr: EnrollmentRow, sinceISO: string): Promise<StepResult> {
    const condition = String(step.config.condition ?? 'always');
    let met = false;
    if (condition === 'has_replied') met = await hasReplied(enr.contact_id, sinceISO);
    else if (condition === 'always') met = true;

    if (met && step.config.then_exit) {
        return { status: 'success', control: 'exit', detail: { condition, met, action: 'exit' } };
    }
    return { status: 'success', control: 'advance', detail: { condition, met } };
}

async function execWebhook(step: StepRow, enr: EnrollmentRow, contact: ContactRow): Promise<StepResult> {
    const url = String(step.config.url ?? '');
    if (!/^https?:\/\//.test(url)) return { status: 'skipped', control: 'advance', detail: { reason: 'no_url' } };
    try {
        const res = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_id: contact.id, enrollment_id: enr.id, sequence_id: enr.sequence_id }),
        });
        return { status: res.ok ? 'success' : 'failed', control: res.ok ? 'advance' : 'retry', detail: { http: res.status } };
    } catch (err) {
        return { status: 'failed', control: 'retry', detail: { error: err instanceof Error ? err.message : 'fetch-fel' } };
    }
}

async function execCreateTask(step: StepRow, enr: EnrollmentRow, contact: ContactRow): Promise<StepResult> {
    const title = render(String(step.config.title ?? 'Uppföljning'), contact);
    const { error } = await supabase.from('tasks').insert({
        customer_id: contact.customer_id ?? null,
        title,
        description: `Skapad av sekvens ${enr.sequence_id} för kontakt ${contact.name ?? contact.id}`,
        status: 'review',
        executor: 'local:echo',
    });
    if (error) return { status: 'failed', control: 'retry', detail: { error: error.message } };
    return { status: 'success', control: 'advance', detail: { title } };
}

/** Vänta till en absolut tid = bastid (context, t.ex. booking_start) + offset.
 *  offset kan vara negativ, t.ex. offset_hours:-24 = "24h innan mötet". */
function execWaitUntil(step: StepRow, enr: EnrollmentRow): StepResult {
    const cfg = step.config;
    const n = (k: string) => (typeof cfg[k] === 'number' ? (cfg[k] as number) : 0);
    const relTo = String(cfg.relative_to ?? 'booking_start');
    const baseIso = relTo === 'now'
        ? new Date().toISOString()
        : (typeof enr.context?.[relTo] === 'string' ? (enr.context[relTo] as string) : null);
    if (!baseIso) {
        return { status: 'skipped', control: 'advance', detail: { reason: 'no_base_time', relative_to: relTo } };
    }
    const offMs = n('offset_minutes') * 60_000 + n('offset_hours') * 3_600_000 + n('offset_days') * 86_400_000;
    const target = new Date(baseIso).getTime() + offMs;
    const waitMs = target - Date.now();
    if (Number.isNaN(target)) return { status: 'skipped', control: 'advance', detail: { reason: 'bad_base_time', baseIso } };
    if (waitMs <= 0) return { status: 'success', control: 'advance', detail: { target: new Date(target).toISOString(), passed: true } };
    return { status: 'success', control: 'wait', waitMs, detail: { target: new Date(target).toISOString() } };
}

export async function execStep(
    step: StepRow, enr: EnrollmentRow, contact: ContactRow, enrolledAtISO: string
): Promise<StepResult> {
    switch (step.type) {
        case 'send_email':  return execSendEmail(step, enr, contact);
        case 'send_sms':    return execSendSms(step, enr, contact);
        case 'move_stage':  return execMoveStage(step, enr);
        case 'add_tag':     return execTag(step, contact, true);
        case 'remove_tag':  return execTag(step, contact, false);
        case 'branch':      return execBranch(step, enr, enrolledAtISO);
        case 'webhook':     return execWebhook(step, enr, contact);
        case 'create_task': return execCreateTask(step, enr, contact);
        case 'exit':        return { status: 'success', control: 'exit', detail: {} };
        case 'wait':        return { status: 'success', control: 'wait', waitMs: waitMsFromConfig(step.config) };
        case 'wait_until':  return execWaitUntil(step, enr);
        default:            return { status: 'skipped', control: 'advance', detail: { reason: `okänd steg-typ ${step.type}` } };
    }
}

// ---------------------------------------------------------------------------
// Enrollment-processor
// ---------------------------------------------------------------------------

async function processEnrollment(enr: EnrollmentRow, enrolledAtISO: string): Promise<void> {
    // Ladda sekvens + kontakt
    const { data: seq } = await supabase
        .from('sequences').select('id, status, exit_on').eq('id', enr.sequence_id).maybeSingle();
    const sequence = seq as SequenceRow | null;
    if (!sequence || sequence.status !== 'active') {
        // Sekvensen är pausad/borta → skjut upp, rör inte enrollment-status
        await supabase.from('sequence_enrollments')
            .update({ next_run_at: new Date(Date.now() + RETRY_BACKOFF_MS).toISOString() })
            .eq('id', enr.id);
        return;
    }

    const { data: c } = await supabase
        .from('contacts').select('id, name, email, phone, custom, tags, customer_id').eq('id', enr.contact_id).maybeSingle();
    const contact = c as ContactRow | null;
    if (!contact) {
        await supabase.from('sequence_enrollments')
            .update({ status: 'failed', exit_reason: 'contact_missing', updated_at: new Date().toISOString() })
            .eq('id', enr.id);
        return;
    }

    let position = enr.current_position;
    for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
        const { data: s } = await supabase
            .from('sequence_steps')
            .select('id, sequence_id, position, type, config')
            .eq('sequence_id', enr.sequence_id).eq('position', position).maybeSingle();
        const step = s as StepRow | null;

        if (!step) {
            // Slut på steg → färdig
            await logStepRun(enr.id, null, { status: 'success', control: 'exit', detail: { reason: 'completed' } });
            await supabase.from('sequence_enrollments').update({
                status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }).eq('id', enr.id);
            return;
        }

        const res = await execStep(step, enr, contact, enrolledAtISO);
        await logStepRun(enr.id, step, res);

        if (res.control === 'exit') {
            await supabase.from('sequence_enrollments').update({
                status: 'exited', exit_reason: step.type === 'exit' ? 'exit_step' : 'branch',
                completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }).eq('id', enr.id);
            return;
        }

        if (res.control === 'wait') {
            // Vänta: hoppa förbi wait-steget och pausa till efter väntetiden
            await supabase.from('sequence_enrollments').update({
                current_position: position + 1,
                next_run_at: new Date(Date.now() + (res.waitMs ?? 0)).toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('id', enr.id);
            return;
        }

        if (res.control === 'retry') {
            const retries = ((enr.context?.retries as number) ?? 0) + 1;
            if (retries > MAX_RETRIES) {
                await supabase.from('sequence_enrollments').update({
                    status: 'failed', exit_reason: 'max_retries', updated_at: new Date().toISOString(),
                }).eq('id', enr.id);
                return;
            }
            await supabase.from('sequence_enrollments').update({
                context: { ...enr.context, retries },
                next_run_at: new Date(Date.now() + RETRY_BACKOFF_MS).toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('id', enr.id);
            return;
        }

        // advance → nästa steg i samma tick
        position += 1;
        await supabase.from('sequence_enrollments')
            .update({ current_position: position, updated_at: new Date().toISOString() }).eq('id', enr.id);
    }

    // Nådde loop-taket → pausa kort, fortsätt nästa tick
    await supabase.from('sequence_enrollments')
        .update({ next_run_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', enr.id);
}

// ---------------------------------------------------------------------------
// Publikt: en tick
// ---------------------------------------------------------------------------

export async function runDueEnrollments(limit = 25): Promise<{ processed: number }> {
    const nowISO = new Date().toISOString();
    const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('id, sequence_id, contact_id, opportunity_id, status, current_position, context, enrolled_at')
        .eq('status', 'active')
        .lte('next_run_at', nowISO)
        .order('next_run_at', { ascending: true })
        .limit(limit);

    if (error) { logger.error('sequenceRunner', `kunde inte hämta enrollments: ${error.message}`); return { processed: 0 }; }
    const rows = (data ?? []) as (EnrollmentRow & { enrolled_at: string })[];

    let processed = 0;
    for (const enr of rows) {
        try {
            await processEnrollment(enr, enr.enrolled_at);
            processed++;
        } catch (err) {
            logger.error('sequenceRunner', `fel på enrollment ${enr.id}: ${err instanceof Error ? err.message : err}`);
            await supabase.from('sequence_enrollments')
                .update({ next_run_at: new Date(Date.now() + RETRY_BACKOFF_MS).toISOString() })
                .eq('id', enr.id).eq('status', 'active');
        }
    }
    if (processed) logger.info('sequenceRunner', `processade ${processed} enrollment(s)`);
    return { processed };
}

/** Starta tick-loopen (anropas från server.ts). Guardad env: SEQUENCE_RUNNER_ENABLED. */
let timer: NodeJS.Timeout | null = null;
export function startSequenceRunner(intervalMs = 60_000): void {
    if (timer) return;
    logger.info('sequenceRunner', `startad, tick var ${Math.round(intervalMs / 1000)}s`);
    timer = setInterval(() => { void runDueEnrollments(); }, intervalMs);
}
