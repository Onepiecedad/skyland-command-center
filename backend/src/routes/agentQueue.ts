import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// GET /api/v1/agent-queue — List agent task queue
// Query params: agent_id, status, priority, limit
// ============================================================================
const queueQuerySchema = z.object({
    agent_id: z.string().optional(),
    status: z.string().optional(), // comma-separated
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get('/', async (req: Request, res: Response) => {
    try {
        const parsed = queueQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues,
            });
        }

        const { agent_id, status, priority, limit } = parsed.data;

        // Build query — fetch open tasks ordered by priority then creation
        let query = supabase
            .from('tasks')
            .select('id, title, description, assigned_agent, status, priority, created_at, updated_at')
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(limit);

        // Default: only show actionable tasks
        if (status) {
            const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
            query = query.in('status', statuses);
        } else {
            query = query.in('status', ['created', 'assigned', 'in_progress', 'review']);
        }

        if (agent_id) {
            query = query.eq('assigned_agent', agent_id);
        }

        if (priority) {
            query = query.eq('priority', priority);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching agent queue:', error);
            return res.status(500).json({ error: error.message });
        }

        // Map priority to numeric sort value for frontend convenience
        const priorityOrder: Record<string, number> = {
            urgent: 4, high: 3, normal: 2, low: 1,
        };

        const queue = (data || []).map(task => ({
            task_id: task.id,
            title: task.title,
            description: task.description,
            assigned_agent_id: task.assigned_agent,
            priority: task.priority,
            priority_level: priorityOrder[task.priority] || 0,
            status: task.status,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }));

        return res.json({
            queue,
            count: queue.length,
        });
    } catch (err) {
        console.error('Unexpected error in agent-queue:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /api/v1/agent-queue/:taskId — Update task in queue
// ============================================================================
const updateQueueSchema = z.object({
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    status: z.enum(['created', 'assigned', 'in_progress', 'review', 'completed', 'failed']).optional(),
    assigned_agent: z.string().optional(),
    description: z.string().optional(),
});

router.put('/:taskId', async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        const parsed = updateQueueSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues,
            });
        }

        const updateData: Record<string, unknown> = {};
        if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
        if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
        if (parsed.data.assigned_agent !== undefined) updateData.assigned_agent = parsed.data.assigned_agent;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const { data, error } = await supabase
            .from('tasks')
            .update(updateData)
            .eq('id', taskId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Task not found' });
            }
            console.error('Error updating queue task:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ task: data });
    } catch (err) {
        console.error('Unexpected error in agent-queue update:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
