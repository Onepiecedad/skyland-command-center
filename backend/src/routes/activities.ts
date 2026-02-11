import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { activitiesQuerySchema, activitySchema } from '../schemas/activities';

const router = Router();

// GET / - list activities with pagination and filtering
router.get('/', async (req: Request, res: Response) => {
    try {
        const parsed = activitiesQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { limit, offset, customer_id, agent, event_type, severity, since } = parsed.data;

        let query = supabase
            .from('activities')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (customer_id) {
            query = query.eq('customer_id', customer_id);
        }

        if (agent) {
            query = query.eq('agent', agent);
        }

        if (event_type) {
            query = query.eq('event_type', event_type);
        }

        if (severity) {
            query = query.eq('severity', severity);
        }

        if (since) {
            query = query.gte('created_at', since);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching activities:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            activities: data,
            paging: { limit, offset }
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST / - create activity
router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = activitySchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { data, error } = await supabase
            .from('activities')
            .insert(parsed.data)
            .select()
            .single();

        if (error) {
            console.error('Error creating activity:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.status(201).json({ activity: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
