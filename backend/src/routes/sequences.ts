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

const router = Router();

const STEP_TYPES = [
    'send_email', 'send_sms', 'wait', 'branch',
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
