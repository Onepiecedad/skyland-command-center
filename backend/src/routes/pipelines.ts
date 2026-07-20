import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { logger } from '../services/logger';
import { emitSystemEvent } from './eventStream.js';
import { onStageChanged } from '../services/sequenceEvents';
import { createAutoTodo } from '../services/todos';

/**
 * Pipelines API (SCC-24, F1: CRM-kärnan)
 *
 * Pipelines, stages and opportunities — the deal/stage model. Mounted under
 * /api/v1/pipelines behind the global authMiddleware.
 */

const router = Router();

// ============================================================================
// GET / — list pipelines, each with its ordered stages
// ============================================================================
router.get('/', async (_req: Request, res: Response) => {
    try {
        const { data: pipelines, error } = await supabase
            .from('pipelines')
            .select('*')
            .order('created_at', { ascending: true });
        if (error) return res.status(500).json({ error: error.message });

        const ids = (pipelines || []).map((p) => p.id);
        const { data: stages } = ids.length
            ? await supabase.from('stages').select('*').in('pipeline_id', ids).order('position', { ascending: true })
            : { data: [] as Array<Record<string, unknown>> };

        const withStages = (pipelines || []).map((p) => ({
            ...p,
            stages: (stages || []).filter((s) => s.pipeline_id === p.id),
        }));
        return res.json({ pipelines: withStages, count: withStages.length });
    } catch (err) {
        console.error('[Pipelines] list error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /:id/board — kanban payload: stages, each with its open opportunities
// (joined with the contact's name for card display).
// ============================================================================
router.get('/:id/board', async (req: Request, res: Response) => {
    try {
        const { data: stages, error: sErr } = await supabase
            .from('stages')
            .select('*')
            .eq('pipeline_id', req.params.id)
            .order('position', { ascending: true });
        if (sErr) return res.status(500).json({ error: sErr.message });
        if (!stages || stages.length === 0) {
            return res.status(404).json({ error: 'Pipeline not found or has no stages' });
        }

        const { data: opps, error: oErr } = await supabase
            .from('opportunities')
            .select('*, contact:contacts(id, name, company, email, phone, tags, custom)')
            .eq('pipeline_id', req.params.id)
            .order('updated_at', { ascending: false });
        if (oErr) return res.status(500).json({ error: oErr.message });

        const columns = stages.map((st) => ({
            stage: st,
            opportunities: (opps || []).filter((o) => o.stage_id === st.id),
        }));
        return res.json({ pipeline_id: req.params.id, columns });
    } catch (err) {
        console.error('[Pipelines] board error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /opportunities — create an opportunity
// ============================================================================
const createOppSchema = z.object({
    contact_id: z.string().uuid().nullish(),
    pipeline_id: z.string().uuid(),
    stage_id: z.string().uuid().nullish(),
    customer_id: z.string().uuid().nullish(),
    title: z.string().min(1),
    value_sek: z.number().nonnegative().nullish(),
});

router.post('/opportunities', async (req: Request, res: Response) => {
    try {
        const parsed = createOppSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const body = parsed.data;

        // Default to the first stage of the pipeline when none is given.
        let stageId = body.stage_id ?? null;
        if (!stageId) {
            const { data: firstStage } = await supabase
                .from('stages')
                .select('id')
                .eq('pipeline_id', body.pipeline_id)
                .order('position', { ascending: true })
                .limit(1)
                .maybeSingle();
            stageId = firstStage?.id ?? null;
        }

        const { data, error } = await supabase
            .from('opportunities')
            .insert({
                contact_id: body.contact_id ?? null,
                pipeline_id: body.pipeline_id,
                stage_id: stageId,
                customer_id: body.customer_id ?? null,
                title: body.title,
                value_sek: body.value_sek ?? null,
            })
            .select('*')
            .single();
        if (error) return res.status(500).json({ error: error.message });

        logger.info('pipelines', `Opportunity created: ${data.id}`, { title: body.title });
        return res.status(201).json({ status: 'created', opportunity: data });
    } catch (err) {
        console.error('[Pipelines] create opp error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /opportunities/:id/move — move an opportunity to another stage.
// Logs an activity so the move is visible in the audit feed / event stream.
// ============================================================================
const moveSchema = z.object({ stage_id: z.string().uuid() });

router.post('/opportunities/:id/move', async (req: Request, res: Response) => {
    try {
        const parsed = moveSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }

        const { data, error } = await supabase
            .from('opportunities')
            .update({ stage_id: parsed.data.stage_id, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select('*, stage:stages(name)')
            .single();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Opportunity not found' });

        const stageName = (data.stage as { name?: string } | null)?.name ?? parsed.data.stage_id;

        await supabase.from('activities').insert({
            customer_id: data.customer_id ?? null,
            agent: 'operator',
            action: 'opportunity.moved',
            event_type: 'opportunity',
            severity: 'info',
            autonomy_level: 'ACT',
            details: { opportunity_id: data.id, title: data.title, stage_id: parsed.data.stage_id, stage_name: stageName },
        });
        emitSystemEvent('opportunity.moved', { opportunity_id: data.id, stage_id: parsed.data.stage_id }, 'pipelines');

        // Auto-logg: dras kortet till Contacted = öppnaren är skickad. Logga den
        // som IG DM i kontaktens konversation (en gång — aldrig vid fram-och-tillbaka).
        if (stageName === 'Contacted' && data.contact_id) {
            try {
                const { data: contact } = await supabase
                    .from('contacts').select('custom').eq('id', data.contact_id).maybeSingle();
                const dmHook = (contact?.custom as Record<string, unknown> | null)?.dm_hook;
                if (typeof dmHook === 'string' && dmHook.trim()) {
                    const opener = dmHook.split(/\n?---\n?/)[0].trim();
                    const { data: prior } = await supabase
                        .from('messages').select('id')
                        .eq('channel', 'instagram')
                        .filter('metadata->>contact_id', 'eq', data.contact_id)
                        .limit(1);
                    if (!prior || prior.length === 0) {
                        await supabase.from('messages').insert({
                            role: 'user',
                            channel: 'instagram',
                            direction: 'outbound',
                            content: opener,
                            metadata: {
                                contact_id: data.contact_id,
                                logged_by: 'stage-move:contacted',
                                interaction: 'ig_dm_outreach',
                            },
                        });
                        logger.info('pipelines', `IG-öppnare auto-loggad för contact ${data.contact_id} (→ Contacted)`);
                    }
                }
            } catch (err) {
                console.error('[Pipelines] auto-log contacted error:', err);
            }
        }

        // Auto-todo vid Meeting Booked: förbered mötet (dedupas per opportunity).
        if (stageName === 'Meeting Booked' && data.contact_id) {
            const { data: c } = await supabase
                .from('contacts').select('name').eq('id', data.contact_id).maybeSingle();
            await createAutoTodo({
                title: `Förbered möte: ${c?.name ?? 'kontakt'}`,
                priority: 'high',
                contactId: data.contact_id,
                opportunityId: data.id,
                autoKey: `meeting:${data.id}`,
            });
        }

        // Sekvens-trigger (SCC-42): stage ändrad → skriv in i matchande sekvenser (fire-and-forget)
        if (data.contact_id) {
            void onStageChanged(data.contact_id, data.pipeline_id ?? null, parsed.data.stage_id, data.id);
        }

        logger.info('pipelines', `Opportunity ${data.id} → ${stageName}`);
        return res.json({ status: 'moved', opportunity: data });
    } catch (err) {
        console.error('[Pipelines] move error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PATCH /opportunities/:id — update fields (title, value, status)
// ============================================================================
const patchOppSchema = z.object({
    title: z.string().min(1).optional(),
    value_sek: z.number().nonnegative().nullish(),
    status: z.enum(['open', 'won', 'lost']).optional(),
}).strict();

router.patch('/opportunities/:id', async (req: Request, res: Response) => {
    try {
        const parsed = patchOppSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });

        const { data, error } = await supabase
            .from('opportunities')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Opportunity not found' });
        return res.json({ status: 'updated', opportunity: data });
    } catch (err) {
        console.error('[Pipelines] patch opp error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
