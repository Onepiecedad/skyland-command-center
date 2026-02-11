import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { progressSchema } from '../schemas/tasks';

const router = Router();

// GET /tasks/:id/progress - current progress for a task
router.get('/tasks/:id/progress', async (req: Request, res: Response) => {
    try {
        const taskId = req.params.id as string;

        // Validate UUID format
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
            return res.status(400).json({ error: 'Invalid task ID format' });
        }

        // Get latest run for this task
        const { data: run, error } = await supabase
            .from('task_runs')
            .select('output, status')
            .eq('task_id', taskId)
            .order('run_number', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Progress fetch error:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!run) {
            return res.json({ progress: null });
        }

        // Extract progress from run output
        const output = run.output as Record<string, unknown> || {};
        const progress = output.progress as {
            percent?: number;
            current_step?: string;
            steps?: Array<{ id: string; name: string; status: string }>;
        } | null;

        return res.json({
            progress: progress || null,
            run_status: run.status
        });

    } catch (err) {
        console.error('Progress fetch error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /tasks/:id/progress - update progress for a running task
router.post('/tasks/:id/progress', async (req: Request, res: Response) => {
    try {
        const taskId = req.params.id as string;

        // Validate UUID format
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
            return res.status(400).json({ error: 'Invalid task ID format' });
        }

        // Validate request body
        const parsed = progressSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.flatten()
            });
        }

        // Get latest running run for this task
        const { data: run, error: fetchError } = await supabase
            .from('task_runs')
            .select('id, output')
            .eq('task_id', taskId)
            .eq('status', 'running')
            .order('run_number', { ascending: false })
            .limit(1)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('Progress update - fetch error:', fetchError);
            return res.status(500).json({ error: fetchError.message });
        }

        if (!run) {
            return res.status(404).json({ error: 'No running run found for this task' });
        }

        // Merge progress into existing output
        const existingOutput = run.output as Record<string, unknown> || {};
        const updatedOutput = {
            ...existingOutput,
            progress: parsed.data.progress
        };

        // Update the run
        const { error: updateError } = await supabase
            .from('task_runs')
            .update({ output: updatedOutput })
            .eq('id', run.id);

        if (updateError) {
            console.error('Progress update error:', updateError);
            return res.status(500).json({ error: updateError.message });
        }

        return res.json({ success: true, progress: parsed.data.progress });

    } catch (err) {
        console.error('Progress update error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
