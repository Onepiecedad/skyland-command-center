import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

const globalRunsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.string().optional(),
    executorPrefix: z.string().optional()
});

// GET /tasks/:id/runs - run history for a task
router.get('/tasks/:id/runs', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verify task exists
        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', id)
            .single();

        if (taskError || !task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Get runs
        const { data, error } = await supabase
            .from('task_runs')
            .select('*')
            .eq('task_id', id)
            .order('queued_at', { ascending: false });

        if (error) {
            console.error('Error fetching task runs:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            runs: data || []
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /runs - global task runs with filters
router.get('/runs', async (req: Request, res: Response) => {
    try {
        const parsed = globalRunsQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { limit, status, executorPrefix } = parsed.data;

        let query = supabase
            .from('task_runs')
            .select('id, task_id, run_number, executor, status, queued_at, started_at, ended_at, output, error, worker_id')
            .order('queued_at', { ascending: false })
            .limit(limit);

        // Filter by status (comma-separated)
        if (status) {
            const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
            if (statuses.length > 0) {
                query = query.in('status', statuses);
            }
        }

        // Filter by executor prefix (e.g., 'n8n', 'local', 'claw')
        if (executorPrefix) {
            query = query.like('executor', `${executorPrefix}%`);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching global runs:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            runs: data || [],
            paging: { limit }
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
