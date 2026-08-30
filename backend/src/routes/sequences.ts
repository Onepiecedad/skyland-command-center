/**
 * Sequences API (SCC-42) — CRUD för sekvenser/steg, enroll och manuell tick.
 * Monteras under /api/v1/sequences (auth-skyddad globalt).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { logger } from '../services/logger';
import { enrollContact } from '../services/sequenceEvents';
import { runDueEnrollments } from '../services/sequenceRunner';
import { getEmailProvider } from '../services/email';
import { getSmsProvider } from '../services/sms';
import { isSuppressed } from '../services/outreach';
import { config } from '../config';

const router = Router();

const STEP_TYPES = [
    'send_email', 'send_sms', 'wait', 'wait_until', 'branch',
    'move_stage', 'add_tag', 'remove_tag', 'create_task', 'webhook', 'exit',
] as const;
const TRIGGERS = [
    'manual', 'contact_created', 'opportunity_created',
    'stage_changed', 'booking_created', 'tag_added', 'reply_received',
] as const;

const stepSchema = z.object({
    type: z.enum(STEP_TYPES),
    config: z.record(z.string(), z.unknown()).default({}),
});

const createSchema = z.object({
    name: z.string().min(1),
    description: z.string().nullish(),
    trigger_type: z.enum(TRIGGERS).default('manual'),
    trigger_config: z.record(z.string(), z.unknown()).default({}),
    exit_on: z.array(z.string()).default([]),
    allow_reenroll: z.boolean().default(false),
    customer_id: z.string().uuid().nullish(),
    steps: z.array(stepSchema).default([]),
});

async function insertSteps(sequenceId: string, steps: z.infer<typeof stepSchema>[]): Promise<void> {
    if (!steps.length) return;
    const rows = steps.map((s, i) => ({ sequence_id: sequenceId, position: i, type: s.type, config: s.config }));
    const { error } = await supabase.from('sequence_steps').insert(rows);
    if (error) throw new Error(error.message);
}

// GET / — lista sekvenser med enkel enrollment-summering
router.get('/', async (_req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('sequences')
        .select('id, name, description, trigger_type, status, created_at')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ sequences: data ?? [] });
});

// ============================================================================
// Skuggvecka (SCC-46) — samlad granskningsvy över alla enrollments:
// vad motorn loggat (shadow/sent/skip), nästa steg, och operatörens facit
// per meddelande (messages.metadata.review = { verdict, note, at }).
// Ligger FÖRE /:id så 'shadow-review' inte tolkas som ett sekvens-id.
// ============================================================================
router.get('/shadow-review', async (_req: Request, res: Response) => {
    try {
        const { data: enrs, error: eErr } = await supabase
            .from('sequence_enrollments')
            .select('id, sequence_id, contact_id, status, current_position, next_run_at, exit_reason, enrolled_at, context')
            .order('enrolled_at', { ascending: false })
            .limit(200);
        if (eErr) return res.status(500).json({ error: eErr.message });
        const enrollments = enrs ?? [];
        if (!enrollments.length) return res.json({ enrollments: [], sequences: [] });

        const seqIds = Array.from(new Set(enrollments.map(e => e.sequence_id)));
        const contactIds = Array.from(new Set(enrollments.map(e => e.contact_id)));
        const enrIds = enrollments.map(e => e.id);

        const [{ data: seqs }, { data: steps }, { data: contacts }, { data: msgs }, { data: runs }] = await Promise.all([
            supabase.from('sequences').select('id, name, status').in('id', seqIds),
            supabase.from('sequence_steps').select('sequence_id, position, type, config').in('sequence_id', seqIds),
            supabase.from('contacts').select('id, name, email, company, tags, custom').in('id', contactIds),
            supabase.from('messages')
                .select('id, channel, direction, status, content, metadata, created_at')
                .in('metadata->>enrollment_id', enrIds)
                .order('created_at', { ascending: true }),
            supabase.from('sequence_step_runs')
                .select('enrollment_id, step_type, status, detail, ran_at')
                .in('enrollment_id', enrIds)
                .order('ran_at', { ascending: true }),
        ]);

        const seqById = new Map((seqs ?? []).map(s => [s.id, s]));
        const contactById = new Map((contacts ?? []).map(c => [c.id, c]));
        const stepsBySeq = new Map<string, { position: number; type: string; config: Record<string, unknown> }[]>();
        for (const st of steps ?? []) {
            const arr = stepsBySeq.get(st.sequence_id) ?? [];
            arr.push(st as { position: number; type: string; config: Record<string, unknown> });
            stepsBySeq.set(st.sequence_id, arr);
        }
        const msgsByEnr = new Map<string, unknown[]>();
        for (const m of msgs ?? []) {
            const eid = String((m.metadata as Record<string, unknown> | null)?.enrollment_id ?? '');
            const arr = msgsByEnr.get(eid) ?? [];
            arr.push({
                id: m.id, channel: m.channel, direction: m.direction, status: m.status, content: m.content,
                to: (m.metadata as Record<string, unknown>)?.to ?? null,
                review: (m.metadata as Record<string, unknown>)?.review ?? null,
                created_at: m.created_at,
            });
            msgsByEnr.set(eid, arr);
        }
        const runsByEnr = new Map<string, unknown[]>();
        for (const r of runs ?? []) {
            const arr = runsByEnr.get(r.enrollment_id) ?? [];
            arr.push({ step_type: r.step_type, status: r.status, detail: r.detail, ran_at: r.ran_at });
            runsByEnr.set(r.enrollment_id, arr);
        }

        const out = enrollments.map(e => {
            const seqSteps = (stepsBySeq.get(e.sequence_id) ?? []).sort((a, b) => a.position - b.position);
            const next = seqSteps.find(st => st.position === e.current_position) ?? null;
            const c = contactById.get(e.contact_id);
            const custom = (c?.custom ?? {}) as Record<string, unknown>;
            return {
                enrollment: {
                    id: e.id, status: e.status, current_position: e.current_position, next_run_at: e.next_run_at,
                    exit_reason: e.exit_reason, enrolled_at: e.enrolled_at, source: (e.context as Record<string, unknown> | null)?.source ?? null,
                },
                sequence: seqById.get(e.sequence_id) ?? { id: e.sequence_id, name: '(okänd)', status: null },
                contact: c ? {
                    id: c.id, name: c.name, email: c.email, company: c.company, tags: c.tags,
                    has_dm: typeof custom.dm_hook === 'string' && custom.dm_hook.trim().length > 0,
                    has_bump: typeof custom.dm_bump === 'string' && custom.dm_bump.trim().length > 0,
                } : null,
                next_step: next ? { position: next.position, type: next.type, config: next.config } : null,
                messages: msgsByEnr.get(e.id) ?? [],
                runs: runsByEnr.get(e.id) ?? [],
            };
        });
        return res.json({ enrollments: out, sequences: seqs ?? [] });
    } catch (err) {
        logger.error('sequences', `shadow-review: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const reviewSchema = z.object({
    verdict: z.enum(['would_send', 'would_not_send']).nullable(),
    note: z.string().max(2000).nullish(),
});

// POST /shadow-review/:messageId — operatörens facit på ett loggat meddelande
router.post('/shadow-review/:messageId', async (req: Request, res: Response) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const { data: m, error: gErr } = await supabase
        .from('messages').select('id, metadata').eq('id', req.params.messageId).maybeSingle();
    if (gErr) return res.status(500).json({ error: gErr.message });
    if (!m) return res.status(404).json({ error: 'Message not found' });
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const review = parsed.data.verdict
        ? { verdict: parsed.data.verdict, note: parsed.data.note ?? null, at: new Date().toISOString() }
        : null;
    const { error: uErr } = await supabase
        .from('messages').update({ metadata: { ...meta, review } }).eq('id', m.id);
    if (uErr) return res.status(500).json({ error: uErr.message });
    return res.json({ ok: true, review });
});

/**
 * POST /shadow-review/:messageId/send — skicka ett GODKÄNT skuggmejl på riktigt.
 *
 * Det här är "manuell kö"-läget: motorn loggar (shadow), operatören dömer, och
 * ett uttryckligt klick per meddelande skickar. Kräver status='shadow' och
 * review.verdict='would_send'. Suppressionslistan och dagsbudgeten gäller.
 * OUTBOUND_ENABLED (kill switch för maskinens EGNA utskick) gäller INTE här:
 * varje anrop är en mänsklig handling, och den loggas som sådan
 * (metadata.sent_from_shadow=true, approved_at).
 */
router.post('/shadow-review/:messageId/send', async (req: Request, res: Response) => {
    const { data: m, error: gErr } = await supabase
        .from('messages').select('*').eq('id', req.params.messageId).maybeSingle();
    if (gErr) return res.status(500).json({ error: gErr.message });
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (m.status !== 'shadow') return res.status(409).json({ error: `Meddelandet är inte ett skuggmejl (status=${m.status})` });
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const review = meta.review as { verdict?: string } | null;
    if (review?.verdict !== 'would_send') return res.status(409).json({ error: 'Meddelandet är inte godkänt (markera "Hade skickat" först)' });
    const to = typeof meta.to === 'string' ? meta.to : '';
    if (!to) return res.status(409).json({ error: 'Mottagare saknas på meddelandet' });

    const channel = m.channel as 'email' | 'sms';
    const hit = await isSuppressed(channel === 'sms' ? 'phone' : 'email', to);
    if (hit) return res.status(409).json({ error: `Mottagaren är spärrad (${hit.kind}: ${hit.reason ?? 'okänd orsak'})` });

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('direction', 'outbound').eq('status', 'sent').gte('created_at', start.toISOString());
    if ((count ?? 0) >= config.OUTBOUND_DAILY_LIMIT) {
        return res.status(429).json({ error: `Dagsbudgeten är nådd (${count}/${config.OUTBOUND_DAILY_LIMIT}). Försök igen i morgon eller höj OUTBOUND_DAILY_LIMIT.` });
    }

    try {
        let providerMessageId: string;
        if (channel === 'sms') {
            providerMessageId = (await getSmsProvider().send({ to, text: m.content })).providerMessageId;
        } else {
            const [subject, ...rest] = String(m.content).split('\n');
            const text = rest.join('\n').replace(/^\n+/, '');
            providerMessageId = (await getEmailProvider().send({ to, subject, text })).providerMessageId;
        }
        const now = new Date().toISOString();
        const { error: uErr } = await supabase.from('messages').update({
            status: 'sent',
            provider_message_id: providerMessageId,
            metadata: { ...meta, shadow: false, sent_from_shadow: true, approved_at: now },
        }).eq('id', m.id);
        if (uErr) return res.status(500).json({ error: uErr.message });
        await supabase.from('activities').insert({
            customer_id: m.customer_id ?? null, agent: 'operator', event_type: 'message',
            action: 'shadow.approved_send', severity: 'info',
            details: { message_id: m.id, to, channel, contact_id: meta.contact_id ?? null, provider_message_id: providerMessageId },
        });
        logger.info('sequences', `skuggmejl ${m.id} skickat på riktigt till ${to} (operatörsgodkänt)`);
        return res.json({ ok: true, provider_message_id: providerMessageId });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'okänt utskicksfel';
        logger.error('sequences', `approved send misslyckades: ${message}`);
        return res.status(502).json({ error: `Utskicket misslyckades: ${message}` });
    }
});

// POST / — skapa sekvens (+ steg)
router.post('/', async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const b = parsed.data;
    try {
        const { data: seq, error } = await supabase.from('sequences').insert({
            name: b.name, description: b.description ?? null,
            trigger_type: b.trigger_type, trigger_config: b.trigger_config,
            exit_on: b.exit_on, allow_reenroll: b.allow_reenroll, customer_id: b.customer_id ?? null,
        }).select('id').single();
        if (error) return res.status(500).json({ error: error.message });
        await insertSteps(seq.id, b.steps);
        logger.info('sequences', `skapade sekvens ${seq.id} (${b.name})`);
        return res.status(201).json({ status: 'created', id: seq.id });
    } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'internt fel' });
    }
});

// GET /:id — sekvens + steg + enrollment-summering
router.get('/:id', async (req: Request, res: Response) => {
    const { data: seq, error } = await supabase.from('sequences').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!seq) return res.status(404).json({ error: 'Sekvens hittades inte' });
    const { data: steps } = await supabase.from('sequence_steps')
        .select('id, position, type, config').eq('sequence_id', req.params.id).order('position');
    const { data: enr } = await supabase.from('sequence_enrollments')
        .select('status').eq('sequence_id', req.params.id);
    const counts = (enr ?? []).reduce<Record<string, number>>((a, e) => {
        const s = (e as { status: string }).status; a[s] = (a[s] ?? 0) + 1; return a;
    }, {});
    return res.json({ sequence: seq, steps: steps ?? [], enrollment_counts: counts });
});

// PATCH /:id — uppdatera status/namn/trigger/exit
const patchSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().nullish(),
    status: z.enum(['draft', 'active', 'paused']).optional(),
    trigger_type: z.enum(TRIGGERS).optional(),
    trigger_config: z.record(z.string(), z.unknown()).optional(),
    exit_on: z.array(z.string()).optional(),
    allow_reenroll: z.boolean().optional(),
});
router.patch('/:id', async (req: Request, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const patch = { ...parsed.data, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('sequences').update(patch).eq('id', req.params.id).select('id, status').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Sekvens hittades inte' });
    return res.json({ status: 'updated', sequence: data });
});

// PUT /:id/steps — ersätt alla steg
router.put('/:id/steps', async (req: Request, res: Response) => {
    const parsed = z.object({ steps: z.array(stepSchema) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    try {
        await supabase.from('sequence_steps').delete().eq('sequence_id', req.params.id);
        await insertSteps(req.params.id, parsed.data.steps);
        return res.json({ status: 'replaced', count: parsed.data.steps.length });
    } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'internt fel' });
    }
});

// POST /:id/enroll — skriv in en kontakt
router.post('/:id/enroll', async (req: Request, res: Response) => {
    const parsed = z.object({
        contact_id: z.string().uuid(),
        opportunity_id: z.string().uuid().nullish(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const r = await enrollContact(req.params.id, parsed.data.contact_id, parsed.data.opportunity_id);
    return res.status(r.enrolled ? 201 : 200).json({ status: r.enrolled ? 'enrolled' : 'skipped', reason: r.reason });
});

// GET /:id/enrollments — lista enrollments
router.get('/:id/enrollments', async (req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('id, contact_id, status, current_position, next_run_at, exit_reason, enrolled_at')
        .eq('sequence_id', req.params.id)
        .order('enrolled_at', { ascending: false })
        .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ enrollments: data ?? [] });
});

// POST /tick — kör en runner-tick manuellt (för test/cron)
router.post('/tick', async (_req: Request, res: Response) => {
    const result = await runDueEnrollments();
    return res.json({ status: 'ticked', ...result });
});

export default router;
