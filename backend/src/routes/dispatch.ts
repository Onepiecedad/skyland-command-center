import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { dispatchSchema, n8nCallbackSchema, clawCallbackSchema, clawResearchOutputSchema } from '../schemas/dispatch';
import { dispatchTask, logTaskRunActivity } from '../services/taskService';

const router = Router();

// POST /tasks/:id/dispatch - dispatch a task for execution
router.post('/tasks/:id/dispatch', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;

        const parsed = dispatchSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const result = await dispatchTask(id, parsed.data.worker_id);

        if (!result.success) {
            return res.status(400).json({
                error: result.error,
                task: result.task,
                run: result.run
            });
        }

        return res.json({
            message: 'Task dispatched successfully',
            task: result.task,
            run: result.run
        });
    } catch (err) {
        console.error('Unexpected error dispatching task:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /n8n/task-result - callback for n8n task completion
router.post('/n8n/task-result', async (req: Request, res: Response) => {
    try {
        const parsed = n8nCallbackSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { task_id, run_id, success, output, error } = parsed.data;

        // Get existing run to fetch task info
        const { data: run, error: runError } = await supabase
            .from('task_runs')
            .select('*, tasks(customer_id)')
            .eq('id', run_id)
            .single();

        if (runError || !run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        const now = new Date().toISOString();

        // Update task_run with error checking
        const { error: runUpdateError } = await supabase
            .from('task_runs')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {},
                error: error ? { message: error } : {},
                ended_at: now
            })
            .eq('id', run_id);

        if (runUpdateError) {
            console.error('Failed to update task_run:', runUpdateError);
            return res.status(500).json({
                error: 'Failed to update run',
                details: runUpdateError.message
            });
        }

        // Update task with error checking
        const { error: taskUpdateError } = await supabase
            .from('tasks')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {}
            })
            .eq('id', task_id);

        if (taskUpdateError) {
            console.error('Failed to update task:', taskUpdateError);
        }

        console.log(`[n8n-callback] Updated run ${run_id} to ${success ? 'completed' : 'failed'}`);

        // Log activity
        const customerId = (run as Record<string, unknown>).tasks
            ? ((run as Record<string, unknown>).tasks as Record<string, unknown>).customer_id as string | null
            : null;

        await logTaskRunActivity(
            customerId,
            task_id,
            run_id,
            success ? 'run_completed' : 'run_failed',
            success ? 'info' : 'error',
            success ? { output } : { error }
        );

        return res.json({
            message: success ? 'Task completed' : 'Task failed',
            task_id,
            run_id,
            status: success ? 'completed' : 'failed'
        });
    } catch (err) {
        console.error('Unexpected error in n8n callback:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /claw/task-result - callback for OpenClaw task completion
router.post('/claw/task-result', async (req: Request, res: Response) => {
    try {
        const parsed = clawCallbackSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { task_id, run_id, success, output, error } = parsed.data;

        // Get existing run to fetch task info
        const { data: run, error: runError } = await supabase
            .from('task_runs')
            .select('*, tasks(customer_id)')
            .eq('id', run_id)
            .single();

        if (runError || !run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        // Best-effort output schema validation for claw:research (Ticket 20)
        let schemaWarning: string | null = null;
        if (success && output && run.executor === 'claw:research') {
            const schemaResult = clawResearchOutputSchema.safeParse(output);
            if (!schemaResult.success) {
                schemaWarning = `Output schema mismatch for claw:research: ${schemaResult.error.issues.map(i => i.message).join(', ')}`;
                console.warn(`[claw-callback] ${schemaWarning}`);
                // Log warning activity
                try {
                    await supabase.from('activities').insert({
                        customer_id: (run as Record<string, unknown>).tasks
                            ? ((run as Record<string, unknown>).tasks as Record<string, unknown>).customer_id
                            : null,
                        agent: 'system:validator',
                        event_type: 'schema_validation',
                        action: 'schema_mismatch',
                        severity: 'warn',
                        details: {
                            task_id,
                            run_id,
                            executor: run.executor,
                            issues: schemaResult.error.issues
                        }
                    });
                } catch (logErr) {
                    console.error('Failed to log schema warning:', logErr);
                }
            }
        }

        const now = new Date().toISOString();

        // Update task_run with error checking
        const { error: runUpdateError } = await supabase
            .from('task_runs')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {},
                error: error ? { message: error } : {},
                ended_at: now
            })
            .eq('id', run_id);

        if (runUpdateError) {
            console.error('Failed to update task_run:', runUpdateError);
            return res.status(500).json({
                error: 'Failed to update run',
                details: runUpdateError.message
            });
        }

        // Update task with error checking
        const { error: taskUpdateError } = await supabase
            .from('tasks')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {}
            })
            .eq('id', task_id);

        if (taskUpdateError) {
            console.error('Failed to update task:', taskUpdateError);
        }

        console.log(`[claw-callback] Updated run ${run_id} to ${success ? 'completed' : 'failed'}`);

        // Log activity
        const customerId = (run as Record<string, unknown>).tasks
            ? ((run as Record<string, unknown>).tasks as Record<string, unknown>).customer_id as string | null
            : null;

        await logTaskRunActivity(
            customerId,
            task_id,
            run_id,
            success ? 'run_completed' : 'run_failed',
            success ? 'info' : 'error',
            success ? { output, source: 'openclaw' } : { error, source: 'openclaw' }
        );

        return res.json({
            message: success ? 'Task completed' : 'Task failed',
            task_id,
            run_id,
            status: success ? 'completed' : 'failed'
        });
    } catch (err) {
        console.error('Unexpected error in claw callback:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
