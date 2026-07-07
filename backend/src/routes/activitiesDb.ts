import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

/**
 * Activities (Supabase-backed) — replaces the legacy in-memory mock
 * for /api/v1/activities. Serves the shape the frontend ActivityLog
 * expects: { id, customer_id, agent, action, event_type, severity,
 * autonomy_level, details, created_at }.
 *
 * The legacy mock remains mounted at /api/activities.
 */

const router = Router();

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    customer_id: z.string().uuid().optional(),
    event_type: z.string().optional(),
    severity: z.enum(['info', 'warn', 'error']).optional(),
    agent: z.string().optional(),
});

// GET / — list activities with filters
router.get('/', async (req: Request, res: Response) => {
    try {
        const parsed = querySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Invalid query parameters',
                details: parsed.error.issues,
            });
        }

        const { limit, offset, customer_id, event_type, severity, agent } = parsed.data;

        let query = supabase
            .from('activities')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (customer_id) query = query.eq('customer_id', customer_id);
        if (event_type) query = query.eq('event_type', event_type);
        if (severity) query = query.eq('severity', severity);
        if (agent) query = query.eq('agent', agent);

        const { data, error } = await query;

        if (error) {
            console.error('[Activities] Fetch failed:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ activities: data || [] });
    } catch (err) {
        console.error('[Activities] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /:id — single activity
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('activities')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Activity not found' });
            }
            return res.status(500).json({ error: error.message });
        }

        return res.json({ activity: data });
    } catch (err) {
        console.error('[Activities] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
