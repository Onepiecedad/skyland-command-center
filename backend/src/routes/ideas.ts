import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================
const createIdeaSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    category: z.string().default('general'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    tags: z.array(z.string()).default([]),
    source: z.string().optional(),
    assigned_to: z.string().optional(),
    due_date: z.string().optional(),
    notes: z.string().optional(),
});

const updateIdeaSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(['new', 'in-progress', 'planned', 'completed', 'archived']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    tags: z.array(z.string()).optional(),
    assigned_to: z.string().optional(),
    due_date: z.string().optional(),
    notes: z.string().optional(),
});

const listIdeasSchema = z.object({
    status: z.enum(['new', 'in-progress', 'planned', 'completed', 'archived']).optional(),
    category: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    tag: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    offset: z.coerce.number().min(0).default(0),
});

// ============================================================================
// GET /ideas - List all ideas
// ============================================================================
router.get('/', async (req: Request, res: Response) => {
    try {
        const parsed = listIdeasSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
        }

        const { status, category, priority, tag, search, limit, offset } = parsed.data;

        let query = supabase
            .from('ideas')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) query = query.eq('status', status);
        if (category) query = query.eq('category', category);
        if (priority) query = query.eq('priority', priority);
        if (tag) query = query.contains('tags', [tag]);
        if (search) {
            query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
        }

        const { data, error, count } = await query;

        if (error) {
            console.error('List ideas error:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        return res.json({
            ideas: data,
            total: count,
            limit,
            offset,
        });
    } catch (err) {
        console.error('List ideas error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /ideas/:id - Get single idea
// ============================================================================
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('ideas')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Idea not found' });
        }

        return res.json({ idea: data });
    } catch (err) {
        console.error('Get idea error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /ideas - Create new idea
// ============================================================================
router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = createIdeaSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
        }

        const { data, error } = await supabase
            .from('ideas')
            .insert(parsed.data)
            .select()
            .single();

        if (error) {
            console.error('Create idea error:', error);
            return res.status(500).json({ error: 'Failed to create idea' });
        }

        return res.status(201).json({ success: true, idea: data });
    } catch (err) {
        console.error('Create idea error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PATCH /ideas/:id - Update idea
// ============================================================================
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateIdeaSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
        }

        // If status is being changed to completed, set completed_at
        const updateData: Record<string, unknown> = { ...parsed.data };
        if (parsed.data.status === 'completed') {
            updateData.completed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('ideas')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: 'Failed to update idea' });
        }

        return res.json({ success: true, idea: data });
    } catch (err) {
        console.error('Update idea error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /ideas/:id - Delete idea
// ============================================================================
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('ideas')
            .delete()
            .eq('id', id);

        if (error) {
            return res.status(500).json({ error: 'Failed to delete idea' });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('Delete idea error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /ideas/stats - Get statistics
// ============================================================================
router.get('/stats/overview', async (_req: Request, res: Response) => {
    try {
        const { data: allIdeas, error } = await supabase
            .from('ideas')
            .select('status, priority, category');

        if (error) {
            console.error('Stats error:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        const ideas = allIdeas || [];

        // Aggregate by status
        const byStatus: Record<string, number> = {};
        for (const idea of ideas) {
            byStatus[idea.status] = (byStatus[idea.status] || 0) + 1;
        }

        // Aggregate by priority
        const byPriority: Record<string, number> = {};
        for (const idea of ideas) {
            byPriority[idea.priority] = (byPriority[idea.priority] || 0) + 1;
        }

        // Aggregate by category
        const byCategory: Record<string, number> = {};
        for (const idea of ideas) {
            byCategory[idea.category] = (byCategory[idea.category] || 0) + 1;
        }

        return res.json({
            byStatus,
            byPriority,
            byCategory,
            total: ideas.length,
        });
    } catch (err) {
        console.error('Stats error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
