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
 *
 * Databasreaktivering (SCC-46):
 * - OUTBOUND_MODE=shadow loggar utskicken som messages.status='shadow' i stället
 *   för att skicka — sekvensen avancerar som vanligt (skuggvecka).
 * - send_email/send_sms med config.source='contact_dm' (+ part='opener'|'followup'|'bump',
 *   valfritt append) tar texten från kortets dm_hook. Mallar kan också använda
 *   {{dm_opener}} / {{dm_followup}}. Saknas delen → synlig skip (no_dm).
 * - Suppressionslistan (suppression_list) kontrolleras före varje utskick, även
 *   i skuggläge. Träff = enrollmenten avslutas med exit_reason='suppressed'.
 *
 * Outbound-policy (stabiliseringsplan fas 1, fynd 4):
 * - sequences.outbound_policy='transactional' (bokningspåminnelser: mottagaren har
 *   själv bokat) går ut OAVSETT OUTBOUND_ENABLED/OUTBOUND_MODE/dagsbudget. Egen
 *   kill switch: TRANSACTIONAL_OUTBOUND_ENABLED. Suppression gäller fortfarande,
 *   utom orsaken 'existing_customer'.
 * - 'outreach' (default) lyder alla grindar som förut.
 */

import { supabase } from './supabase';
import { config } from '../config';
import { getEmailProvider } from './email';
import { getSmsProvider } from './sms';
import { outboundMode, splitDm, isSuppressed, suppressionApplies, normalizePolicy, msUntilWindowOpen, outreachJitterMs, countSentToday, budgetKey, dailyLimitFor, type OutboundPolicy, type OutboundMode } from './outreach';
import { logger } from './logger';

const MAX_STEPS_PER_TICK = 50;      // skydd mot oändliga loopar
const RETRY_BACKOFF_MS = 30 * 60_000; // 30 min vid TRANSPORTFEL (provider nere, DB-fel)
const MAX_RETRIES = 5;
/** Policy-/budgetstopp (kill switch av, dagstak nått, väntar på godkännande) är
 *  INTE fel: de skjuts upp utan att räkna upp retries. Annars dog en kö som
 *  mötte fullt dagstak på morgonen efter 5 × 30 min som failed/max_retries. */
const POLICY_HOLD_MS = 60 * 60_000;
/** Steg med require_approval väntar på klick i Skuggvecka; kolla var 15:e min. */
const APPROVAL_HOLD_MS = 15 * 60_000;
/** Hur länge en enrollment är "claimad" av en tick innan en annan tick får ta den. */
const CLAIM_MS = 10 * 60_000;

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
    outbound_policy?: string | null;
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

type Control = 'advance' | 'wait' | 'exit' | 'retry' | 'defer';

/** Plan 2.5: uppskjutning av LIVE outreach till arbetstidsfönstret + slumpad
 *  spridning. Returnerar ms att vänta, 0 = skicka nu. Skuggläge och transactional
 *  berörs aldrig. context.spread_pos håller reda på att spridningen bara läggs
 *  EN gång per steg (annars skjuts sändningen för evigt). */
function outreachDeferMs(enr: EnrollmentRow, position: number, policy: OutboundPolicy, mode: string): number {
    if (!config.OUTREACH_WINDOW_ENABLED || policy === 'transactional' || mode !== 'live') return 0;
    const alreadySpread = enr.context?.spread_pos === position;
    const untilOpen = msUntilWindowOpen();
    if (untilOpen > 0) return untilOpen + (alreadySpread ? 0 : outreachJitterMs());
    if (!alreadySpread && config.OUTREACH_JITTER_MINUTES > 0) {
        // Inne i fönstret men ännu inte spridd: skjut 1..JITTER min (aldrig 0 — då
        // skulle en batch ändå fyra i samma tick).
        return Math.max(60_000, outreachJitterMs());
    }
    return 0;
}
interface StepResult {
    status: 'success' | 'skipped' | 'failed';
    control: Control;
    waitMs?: number;
    /** Absolut tidpunkt (ms) för wait_until — får INTE ankras om på senaste utskick. */
    targetAt?: number;
    detail?: Record<string, unknown>;
}

/** Uppskjutning som inte är ett fel: räknar inte retries, rör inte spread_pos. */
function hold(waitMs: number, detail: Record<string, unknown>): StepResult {
    return { status: 'success', control: 'defer', waitMs, detail: { ...detail, policy_hold: true } };
}

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

function render(text: string, contact: ContactRow): string {
    const first = (contact.name || '').trim().split(/\s+/)[0] || '';
    const dm = splitDm(contact.custom);
    return String(text || '')
        .replace(/\{\{\s*first_name\s*\}\}/gi, first)
        .replace(/\{\{\s*name\s*\}\}/gi, contact.name || '')
        .replace(/\{\{\s*email\s*\}\}/gi, contact.email || '')
        .replace(/\{\{\s*dm_opener\s*\}\}/gi, dm?.opener ?? '')
        .replace(/\{\{\s*dm_followup\s*\}\}/gi, dm?.followup ?? '')
        // {{custom.nyckel}} — läser contact.custom. Behövs för att ämnesraden ska
        // kunna variera per kort: Cold Experience-leads har tre olika avsikter
        // (vill boka, vill veta mer, reser senare) och en gemensam ämnesrad hade
        // passat ingen av dem. Bara strängar och tal släpps igenom; ett objekt
        // eller en array skulle bli "[object Object]" i gästens inkorg, och
        // saknad nyckel ger tom sträng precis som variablerna ovan.
        .replace(/\{\{\s*custom\.([a-zA-Z0-9_]+)\s*\}\}/g, (_helaTraffen, nyckel: string) => {
            const v = contact.custom?.[nyckel];
            return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
        });
}

/** Personaliserat innehåll (databasreaktivering): source='contact_dm' hämtar
 *  öppnare/uppföljning från kortets dm_hook (som dm_pipeline sparade den).
 *  Returnerar null om kortet saknar den delen — då hoppas steget synligt. */
function bodyFromConfig(cfg: Record<string, unknown>, contact: ContactRow, key: 'body' | 'text'): string | null {
    const source = String(cfg.source ?? 'template');
    if (source === 'contact_dm') {
        const dm = splitDm(contact.custom);
        const which = String(cfg.part ?? 'opener');
        // 'bump' = tystnadsuppföljningen som bump_pipeline sparar i custom.dm_bump
        const part = which === 'followup' ? dm?.followup
            : which === 'bump' ? (typeof contact.custom?.dm_bump === 'string' ? contact.custom.dm_bump.trim() : '')
            : dm?.opener;
        if (!part) return null;
        const suffix = typeof cfg.append === 'string' ? render(cfg.append, contact) : '';
        return suffix ? `${part}\n\n${suffix}` : part;
    }
    const tpl = String(cfg[key] ?? cfg.body ?? '');
    if (/\{\{\s*dm_(opener|followup)\s*\}\}/i.test(tpl)) {
        const dm = splitDm(contact.custom);
        const needsFollowup = /\{\{\s*dm_followup\s*\}\}/i.test(tpl);
        if (!dm || (needsFollowup && !dm.followup)) return null;
    }
    return render(tpl, contact);
}

/** Skuggläge: logga exakt det som skulle skickats, rör ingen provider.
 *
 * Två lägen:
 *  - Globalt skuggläge (OUTBOUND_MODE=shadow): torrkörning — logga och gå vidare,
 *    så hela flödet syns i Skuggvecka. Som förut.
 *  - Steg med `require_approval: true` (manuell kö): logga EN gång och håll
 *    kvar enrollmenten på steget tills operatören klickat "Skicka nu". Först då
 *    går motorn vidare till wait-steget, som därmed ankras på det faktiska
 *    utskicket. Tidigare gick motorn vidare direkt, wait ankrades på ÖPPNARENS
 *    sändtid och avslutsutkastet dök upp i Skuggvecka för tidigt. */
async function logShadow(
    channel: 'email' | 'sms', step: StepRow, enr: EnrollmentRow, contact: ContactRow, to: string, content: string, extra: Record<string, unknown> = {}
): Promise<StepResult> {
    const manualQueue = step.config?.require_approval === true;
    if (manualQueue) {
        const existing = await findShadowForStep(enr.id, step.id);
        if (existing) {
            if (existing.status === 'sent') {
                return { status: 'success', control: 'advance',
                         detail: { to, shadow: true, approved: true, approved_at: existing.approved_at, message_id: existing.id } };
            }
            // Finns redan ett utkast (granskat eller inte) — vänta på klicket.
            return hold(APPROVAL_HOLD_MS, { reason: 'awaiting_approval', message_id: existing.id, verdict: existing.verdict });
        }
    }
    await supabase.from('messages').insert({
        customer_id: contact.customer_id ?? null,
        role: 'assistant', channel, direction: 'outbound', status: 'shadow',
        content,
        metadata: { contact_id: contact.id, enrollment_id: enr.id, sequence_id: enr.sequence_id, step_id: step.id, position: step.position, to, shadow: true, ...extra },
    });
    if (manualQueue) {
        return hold(APPROVAL_HOLD_MS, { reason: 'awaiting_approval', created: true, to });
    }
    return { status: 'success', control: 'advance', detail: { to, shadow: true } };
}

/** Skuggmeddelandet för exakt detta steg i denna enrollment (om något). */
async function findShadowForStep(
    enrollmentId: string, stepId: string
): Promise<{ id: string; status: string; approved_at: string | null; verdict: string | null } | null> {
    const { data } = await supabase
        .from('messages')
        .select('id, status, metadata, created_at')
        .eq('direction', 'outbound')
        .contains('metadata', { enrollment_id: enrollmentId, step_id: stepId })
        .order('created_at', { ascending: false })
        .limit(5);
    const rows = (data ?? []) as { id: string; status: string; metadata: Record<string, unknown> | null }[];
    if (rows.length === 0) return null;
    const sent = rows.find(r => r.status === 'sent');
    const m = sent ?? rows[0];
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const review = (meta.review ?? null) as { verdict?: string } | null;
    return {
        id: m.id, status: m.status,
        approved_at: typeof meta.approved_at === 'string' ? meta.approved_at : null,
        verdict: review?.verdict ?? null,
    };
}

function waitMsFromConfig(cfg: Record<string, unknown>): number {
    const n = (k: string) => (typeof cfg[k] === 'number' ? (cfg[k] as number) : 0);
    return n('minutes') * 60_000 + n('hours') * 3_600_000 + n('days') * 86_400_000;
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

/** Ligger kortet i ett steg som betyder att en människa tagit över?
 *
 *  hasReplied fångar bara det gästen SKRIVER. Ringer Gustav upp i stället, eller
 *  drar han kortet till Överlämnad efter ett samtal, finns inget inkommande
 *  meddelande och sekvensen hade fortsatt med "du har inte hört av dig" till någon
 *  han pratade med i förrgår. Motorns exit_on-mekanism täcker inte heller det:
 *  fireExit känner bara reply_received och bokningshändelser, och stage_changed
 *  finns bara som TRIGGER, aldrig som exit.
 *
 *  Jämförelsen görs på stegets namn, inte id, så att samma sekvenskonfiguration
 *  fungerar i flera pipelines. */
async function inStage(enr: EnrollmentRow, namn: string[]): Promise<boolean> {
    if (!namn.length) return false;
    const q = supabase.from('opportunities').select('stage_id').limit(1);
    const { data: opp } = enr.opportunity_id
        ? await q.eq('id', enr.opportunity_id).maybeSingle()
        : await q.eq('contact_id', enr.contact_id).order('updated_at', { ascending: false }).maybeSingle();
    if (!opp?.stage_id) return false;
    const { data: stage } = await supabase.from('stages').select('name').eq('id', opp.stage_id).maybeSingle();
    const nu = (stage?.name ?? '').trim().toLowerCase();
    return namn.some(n => n.trim().toLowerCase() === nu);
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

/** Läget för ETT steg.
 *
 * Ett steg med `require_approval: true` går aldrig live, oavsett globalt läge:
 * det loggas som skuggrad och väntar på ett klick i Skuggvecka. Det gör att
 * öppnaren kan gå på autosend medan bump och avslut stannar i manuell kö —
 * beslut 5 sep 2026, efter att bumpen till Ambers lästes som en kundfråga.
 *
 * Kill switchen vinner alltid: är läget 'off' förblir det 'off'. En flagga som
 * kan göra systemet försiktigare får inte kunna göra det djärvare.
 */
function stepMode(step: StepRow, policy: OutboundPolicy): OutboundMode {
    const base = outboundMode(policy);
    if (base === 'off') return 'off';
    return step.config?.require_approval === true ? 'shadow' : base;
}

async function execSendEmail(
    step: StepRow, enr: EnrollmentRow, contact: ContactRow, policy: OutboundPolicy
): Promise<StepResult> {
    const mode = stepMode(step, policy);
    if (mode === 'off') {
        const reason = policy === 'transactional' ? 'TRANSACTIONAL_OUTBOUND_ENABLED=false' : 'OUTBOUND_ENABLED=false';
        // Kill switch är ett policybeslut, inte ett fel: vänta, räkna inte retries.
        return hold(POLICY_HOLD_MS, { reason, policy });
    }
    const to = contact.email || (typeof contact.custom?.email === 'string' ? (contact.custom!.email as string) : null);
    if (!to) { await logSkip(contact, enr.sequence_id, 'email', 'no_email'); return { status: 'skipped', control: 'advance', detail: { reason: 'no_email' } }; }

    // Suppressionslistan gäller ÄVEN i skuggläge — spärrade adresser ska aldrig ens köas.
    const hit = await isSuppressed('email', to);
    if (suppressionApplies(hit, policy)) {
        await logSkip(contact, enr.sequence_id, 'email', `suppressed:${hit!.kind}:${hit!.reason ?? ''}`);
        return { status: 'skipped', control: 'exit', detail: { reason: 'suppressed', exit_reason: 'suppressed', hit } };
    }

    const subject = render(String(step.config.subject ?? ''), contact);
    const body = bodyFromConfig(step.config, contact, 'body');
    if (body === null) {
        await logSkip(contact, enr.sequence_id, 'email', 'no_dm');
        return { status: 'skipped', control: 'advance', detail: { reason: 'no_dm', part: step.config.part ?? 'opener' } };
    }
    if (!subject.trim() || !body.trim()) {
        await logSkip(contact, enr.sequence_id, 'email', 'empty_email');
        return { status: 'skipped', control: 'advance', detail: { reason: 'empty_email' } };
    }

    // Avsändaren är en sekvensinställning, inte en global. Cold Experience-mejl
    // måste komma från gustav@coldexperience.se; utan step.config.from gick de
    // ut som joakim@send.skylandai.se, vilket är fel avsändare till fel gäst.
    const from = typeof step.config.from === 'string' && step.config.from.trim()
        ? step.config.from.trim() : undefined;
    const budget = budgetKey('email', from);

    // Skuggraden bär avsändaren och hinken vidare. Operatörens "Skicka nu"
    // läser metadata rakt av, så utan dem gick ett godkänt utkast iväg från fel
    // adress och drogs från fel budget.
    if (mode === 'shadow') {
        return logShadow('email', step, enr, contact, to, `${subject}\n\n${body}`,
                         { subject, from: from ?? null, budget_key: budget, policy });
    }

    const deferEmail = outreachDeferMs(enr, step.position, policy, mode);
    if (deferEmail > 0) {
        return { status: 'success', control: 'defer', waitMs: deferEmail,
                 detail: { reason: 'outreach_window', resume_at: new Date(Date.now() + deferEmail).toISOString() } };
    }

    // Dagsbudgeten är en outreach-broms. Transaktionell post är volymbegränsad av
    // sig själv (en påminnelse per bokning) och får inte fastna bakom kalla mejl.
    // Den RÄKNAS ändå i hinken: mottagarens brevlåda ser ingen skillnad på
    // bokningsbekräftelse och utkorg, så volymen mot domänen är densamma.
    if (policy !== 'transactional') {
        const sentToday = await countSentToday(budget);
        const limit = dailyLimitFor(budget);
        if (sentToday >= limit) {
            // Fullt dagstak = vänta tills räknaren nollställs, inte ett fel att räkna upp.
            return hold(POLICY_HOLD_MS, { reason: 'daily_limit', budget_key: budget, sentToday, limit });
        }
    }

    try {
        const result = await getEmailProvider().send({
            to, subject, text: body, from,
            replyTo: typeof step.config.reply_to === 'string' ? step.config.reply_to : undefined,
        });
        await supabase.from('messages').insert({
            customer_id: contact.customer_id ?? null,
            role: 'assistant', channel: 'email', direction: 'outbound', status: 'sent',
            content: `${subject}\n\n${body}`,
            metadata: { contact_id: contact.id, enrollment_id: enr.id, sequence_id: enr.sequence_id, to, policy, from: from ?? null, budget_key: budget },
            provider_message_id: result.providerMessageId,
        });
        return { status: 'success', control: 'advance', detail: { to, provider_message_id: result.providerMessageId, policy, budget_key: budget } };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'okänt utskicksfel';
        return { status: 'failed', control: 'retry', detail: { error: message } };
    }
}

async function execSendSms(
    step: StepRow, enr: EnrollmentRow, contact: ContactRow, policy: OutboundPolicy
): Promise<StepResult> {
    const mode = stepMode(step, policy);
    if (mode === 'off') {
        const reason = policy === 'transactional' ? 'TRANSACTIONAL_OUTBOUND_ENABLED=false' : 'OUTBOUND_ENABLED=false';
        // Kill switch är ett policybeslut, inte ett fel: vänta, räkna inte retries.
        return hold(POLICY_HOLD_MS, { reason, policy });
    }
    const phone = contact.phone || (typeof contact.custom?.phone === 'string' ? (contact.custom!.phone as string) : null);
    if (!phone) {
        await logSkip(contact, enr.sequence_id, 'sms', 'no_phone');
        return { status: 'skipped', control: 'advance', detail: { reason: 'no_phone' } };
    }
    const hit = await isSuppressed('phone', phone);
    if (suppressionApplies(hit, policy)) {
        await logSkip(contact, enr.sequence_id, 'sms', `suppressed:${hit!.kind}:${hit!.reason ?? ''}`);
        return { status: 'skipped', control: 'exit', detail: { reason: 'suppressed', exit_reason: 'suppressed', hit } };
    }
    const text = bodyFromConfig(step.config, contact, 'text');
    if (text === null) {
        await logSkip(contact, enr.sequence_id, 'sms', 'no_dm');
        return { status: 'skipped', control: 'advance', detail: { reason: 'no_dm', part: step.config.part ?? 'opener' } };
    }
    if (!text.trim()) {
        await logSkip(contact, enr.sequence_id, 'sms', 'empty_sms');
        return { status: 'skipped', control: 'advance', detail: { reason: 'empty_sms' } };
    }
    if (mode === 'shadow') return logShadow('sms', step, enr, contact, phone, text, { budget_key: budgetKey('sms'), policy });

    const deferSms = outreachDeferMs(enr, step.position, policy, mode);
    if (deferSms > 0) {
        return { status: 'success', control: 'defer', waitMs: deferSms,
                 detail: { reason: 'outreach_window', resume_at: new Date(Date.now() + deferSms).toISOString() } };
    }

    const smsBudget = budgetKey('sms');
    if (policy !== 'transactional') {
        const sentToday = await countSentToday(smsBudget);
        const limit = dailyLimitFor(smsBudget);
        if (sentToday >= limit) {
            // Fullt dagstak = vänta tills räknaren nollställs, inte ett fel att räkna upp.
            return hold(POLICY_HOLD_MS, { reason: 'daily_limit', budget_key: smsBudget, sentToday, limit });
        }
    }
    try {
        const result = await getSmsProvider().send({ to: phone, text });
        await supabase.from('messages').insert({
            customer_id: contact.customer_id ?? null,
            role: 'assistant', channel: 'sms', direction: 'outbound',
            content: text,
            metadata: { contact_id: contact.id, enrollment_id: enr.id, sequence_id: enr.sequence_id, to: phone, policy, budget_key: smsBudget },
            provider_message_id: result.providerMessageId,
        });
        return { status: 'success', control: 'advance', detail: { to: phone, provider_message_id: result.providerMessageId, policy } };
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
    // 'in_stage' + config.stages: ['Överlämnad', ...] — sant när kortet står i något
    // av stegen. Med then_exit blir det bromsen för "en människa har tagit över".
    else if (condition === 'in_stage') {
        met = await inStage(enr, Array.isArray(step.config.stages) ? (step.config.stages as unknown[]).map(String) : []);
    }
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
    // targetAt = absolut tid. Wait-hanteraren får INTE ankra om den på senaste
    // utskick (det gav "24h före mötet" räknat från bekräftelsemejlets sändtid).
    return { status: 'success', control: 'wait', waitMs, targetAt: target, detail: { target: new Date(target).toISOString() } };
}

export async function execStep(
    step: StepRow, enr: EnrollmentRow, contact: ContactRow, enrolledAtISO: string,
    policy: OutboundPolicy = 'outreach'
): Promise<StepResult> {
    switch (step.type) {
        case 'send_email':  return execSendEmail(step, enr, contact, policy);
        case 'send_sms':    return execSendSms(step, enr, contact, policy);
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

/** När gick det senaste mejlet i den här enrollmenten FAKTISKT iväg?
 *
 * Väntetiden räknades förut från när motorn passerade wait-steget. I skuggläge
 * loggar sändsteget bara ett utkast och returnerar advance, så klockan startade
 * medan mejlet fortfarande låg ogjort i kön. Den 3 sep 2026 klickades sju
 * skuggrader iväg två dygn efter att de skapats: motorn trodde att bumpen gick
 * 1 sep, mottagarna fick den 3 sep, och avslutsmejlet låg därmed 54 timmar för
 * tidigt. Fyra kliniker fick öppnare och bump 35 timmar isär i stället för tre
 * dygn.
 *
 * approved_at sätts när en operatör klickar "Skicka nu"; saknas den är
 * created_at rätt, för då skickade maskinen själv och tidpunkterna sammanfaller.
 */
async function lastActualSendAt(enrollmentId: string): Promise<number | null> {
    const { data } = await supabase
        .from('messages')
        .select('created_at, metadata')
        .eq('direction', 'outbound')
        .eq('status', 'sent')
        .contains('metadata', { enrollment_id: enrollmentId })
        .order('created_at', { ascending: false })
        .limit(20);
    let senaste: number | null = null;
    for (const m of data ?? []) {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        const iso = typeof meta.approved_at === 'string' ? meta.approved_at : (m.created_at as string);
        const t = Date.parse(iso);
        if (Number.isFinite(t) && (senaste === null || t > senaste)) senaste = t;
    }
    return senaste;
}

function withoutRetries(ctx: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const { retries: _drop, ...rest } = (ctx ?? {}) as Record<string, unknown>;
    return rest;
}

async function processEnrollment(enr: EnrollmentRow, enrolledAtISO: string): Promise<void> {
    // Ladda sekvens + kontakt
    const { data: seq } = await supabase
        .from('sequences').select('id, status, exit_on, outbound_policy').eq('id', enr.sequence_id).maybeSingle();
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

    const policy = normalizePolicy(sequence.outbound_policy);
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

        const res = await execStep(step, enr, contact, enrolledAtISO, policy);
        await logStepRun(enr.id, step, res);

        if (res.control === 'exit') {
            await supabase.from('sequence_enrollments').update({
                status: 'exited',
                exit_reason: typeof res.detail?.exit_reason === 'string' ? res.detail.exit_reason
                    : step.type === 'exit' ? 'exit_step' : 'branch',
                completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }).eq('id', enr.id);
            return;
        }

        if (res.control === 'defer') {
            // Plan 2.5: samma steg körs om när fönstret öppnar; spread_pos ser till
            // att spridningen inte läggs på igen då. Policy-hold (kill switch,
            // dagstak, väntar på godkännande) är inte en spridning och rör inte
            // spread_pos — och nollställer retries, för det var inget fel.
            const ctx = res.detail?.policy_hold === true
                ? withoutRetries(enr.context)
                : { ...withoutRetries(enr.context), spread_pos: position };
            enr.context = ctx;
            await supabase.from('sequence_enrollments').update({
                context: ctx,
                next_run_at: new Date(Date.now() + (res.waitMs ?? 60_000)).toISOString(),
                updated_at: new Date().toISOString(),
            }).eq('id', enr.id);
            return;
        }

        if (res.control === 'wait') {
            // Vänta: hoppa förbi wait-steget och pausa till efter väntetiden.
            // Klockan startar när föregående mejl FAKTISKT gick, inte när motorn
            // råkade passera hit — annars räknar en skuggrad som godkänns sent
            // ned en tid som aldrig löpt. max(nu, ...) så ett gammalt ankare
            // aldrig ger en tidpunkt i det förflutna. Saknas ankare (inget
            // utskick ännu i enrollmenten) gäller nu, som förut.
            const waitMs = res.waitMs ?? 0;
            let nasta: number;
            if (typeof res.targetAt === 'number') {
                // wait_until: absolut tidpunkt (t.ex. 24h före mötet). Ankringen
                // nedan gäller bara relativa intervall ("vänta 3 dagar").
                nasta = Math.max(Date.now(), res.targetAt);
            } else {
                const ankare = await lastActualSendAt(enr.id);
                nasta = ankare === null
                    ? Date.now() + waitMs
                    : Math.max(Date.now(), ankare + waitMs);
            }
            enr.context = withoutRetries(enr.context);
            await supabase.from('sequence_enrollments').update({
                current_position: position + 1,
                context: enr.context,
                next_run_at: new Date(nasta).toISOString(),
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

        // advance → nästa steg i samma tick. Ett lyckat steg nollställer retries:
        // räknaren ackumulerades annars över hela enrollmentens livstid, så fem
        // spridda transportfel över flera veckor gav failed/max_retries.
        position += 1;
        enr.context = withoutRetries(enr.context);
        await supabase.from('sequence_enrollments')
            .update({ current_position: position, context: enr.context, updated_at: new Date().toISOString() }).eq('id', enr.id);
    }

    // Nådde loop-taket → pausa kort, fortsätt nästa tick
    await supabase.from('sequence_enrollments')
        .update({ next_run_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', enr.id);
}

// ---------------------------------------------------------------------------
// Publikt: en tick
// ---------------------------------------------------------------------------

let tickInFlight = false;

export async function runDueEnrollments(limit = 25): Promise<{ processed: number }> {
    // setInterval väntar inte på förra ticken. Tar en tick > intervallet (25 mejl
    // med providerlatens) startade nästa ovanpå och samma enrollment kördes två
    // gånger. En tick i taget per process; claim nedan skyddar över processer.
    if (tickInFlight) {
        logger.warn('sequenceRunner', 'förra ticken pågår fortfarande — hoppar över denna');
        return { processed: 0 };
    }
    tickInFlight = true;
    try {
        return await runDueEnrollmentsInner(limit);
    } finally {
        tickInFlight = false;
    }
}

async function runDueEnrollmentsInner(limit: number): Promise<{ processed: number }> {
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
            // Atomisk claim: flytta next_run_at framåt BARA om raden fortfarande är
            // förfallen. Får vi ingen rad tillbaka har en annan tick/process redan
            // tagit den. processEnrollment skriver sedan sitt eget next_run_at.
            const { data: claimed } = await supabase
                .from('sequence_enrollments')
                .update({ next_run_at: new Date(Date.now() + CLAIM_MS).toISOString() })
                .eq('id', enr.id).eq('status', 'active').lte('next_run_at', nowISO)
                .select('id');
            if (!claimed || claimed.length === 0) continue;
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
