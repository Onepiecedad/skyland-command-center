/**
 * Todos-route — operatörens att-göra-lista.
 * Mountas under /api/v1/todos (bakom global Bearer-auth).
 *
 * GET    /            lista (öppna som standard, ?done=true för avklarade)
 * POST   /            skapa manuell todo
 * PATCH  /:id         uppdatera (titel, notis, due_at, prio, done)
 * DELETE /:id         ta bort
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { createTodo, syncFollowupTodos } from '../services/todos';

const router = Router();

const listSchema = z.object({
    done: z.enum(['true', 'false', 'all']).default('false'),
    contact_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
});

const createSchema = z.object({
    title: z.string().min(1).max(500),
    notes: z.string().max(4000).optional(),
    due_at: z.string().datetime().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    contact_id: z.string().uuid().optional(),
    opportunity_id: z.string().uuid().optional(),
});

const updateSchema = z.object({
    title: z.string().min(1).max(500).optional(),
    notes: z.string().max(4000).nullable().optional(),
    due_at: z.string().datetime().nullable().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    done: z.boolean().optional(),
});

// GET / — lista todos
router.get('/', async (req: Request, res: Response) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
    }
    const { done, contact_id, limit } = parsed.data;

    let query = supabase
        .from('todos')
        .select('*')
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(limit);

    if (done !== 'all') query = query.eq('done', done === 'true');
    if (contact_id) query = query.eq('contact_id', contact_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ todos: data ?? [] });
});

// POST /sync — auto-generera "Följ upp igen"-todos (schemaläggs via cron/scheduled task)
router.post('/sync', async (req: Request, res: Response) => {
    const days = Math.max(1, Math.min(30, Number(req.query.days) || 3));
    try {
        const result = await syncFollowupTodos(days);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
    }
});

// POST / — skapa manuell todo
router.post('/', async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
    }
    try {
        const todo = await createTodo({
            title: parsed.data.title,
            notes: parsed.data.notes,
            dueAt: parsed.data.due_at,
            priority: parsed.data.priority,
            contactId: parsed.data.contact_id,
            opportunityId: parsed.data.opportunity_id,
            source: 'manual',
        });
        return res.status(201).json({ todo });
    } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
    }
});

// PATCH /:id — uppdatera
router.patch('/:id', async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const { title, notes, due_at, priority, done } = parsed.data;
    if (title !== undefined) patch.title = title;
    if (notes !== undefined) patch.notes = notes;
    if (due_at !== undefined) patch.due_at = due_at;
    if (priority !== undefined) patch.priority = priority;
    if (done !== undefined) {
        patch.done = done;
        patch.completed_at = done ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
        .from('todos')
        .update(patch)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) {
        if (error.code === 'PGRST116') return res.status(404).json({ error: 'Todo not found' });
        return res.status(500).json({ error: error.message });
    }
    return res.json({ todo: data });
});

// DELETE /:id
router.delete('/:id', async (req: Request, res: Response) => {
    const { error } = await supabase.from('todos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
});

export default router;
