import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { tasksQuerySchema, createTaskSchema, updateTaskSchema, approveTaskSchema } from '../schemas/tasks';

const router = Router();

// GET / - list tasks with pagination and filtering
router.get('/', async (req: Request, res: Response) => {
    try {
        const parsed = tasksQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { limit, offset, customer_id, assigned_agent, status, priority } = parsed.data;

        let query = supabase
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (customer_id) {
            query = query.eq('customer_id', customer_id);
        }

        if (assigned_agent) {
            query = query.eq('assigned_agent', assigned_agent);
        }

        if (status) {
            query = query.eq('status', status);
        }

        if (priority) {
            query = query.eq('priority', priority);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching tasks:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            tasks: data,
            paging: { limit, offset }
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST / - create task
router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = createTaskSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { data, error } = await supabase
            .from('tasks')
            .insert(parsed.data)
            .select()
            .single();

        if (error) {
            console.error('Error creating task:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.status(201).json({ task: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /:id - update task
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const parsed = updateTaskSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        // Check if task exists
        const { data: existing, error: checkError } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Build update object with only provided fields
        const updateData: Record<string, unknown> = {};
        if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
        if (parsed.data.assigned_agent !== undefined) updateData.assigned_agent = parsed.data.assigned_agent;
        if (parsed.data.output !== undefined) updateData.output = parsed.data.output;
        if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const { data, error } = await supabase
            .from('tasks')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating task:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ task: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /:id - single task by ID
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data: task, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        return res.json({ task });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /:id/approve - approve a SUGGEST task
router.post('/:id/approve', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const parsed = approveTaskSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        // Get task and check status
        const { data: task, error: fetchError } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        if (task.status !== 'review') {
            return res.status(400).json({
                error: 'Task is not in review status',
                current_status: task.status
            });
        }

        // Determine new status: in_progress if assigned_agent exists, otherwise assigned
        const newStatus = task.assigned_agent ? 'in_progress' : 'assigned';

        const { data, error } = await supabase
            .from('tasks')
            .update({
                approved_by: parsed.data.approved_by,
                approved_at: new Date().toISOString(),
                status: newStatus
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error approving task:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ task: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /:id/children - list child tasks
router.get('/:id/children', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verify parent task exists
        const { data: parentTask, error: parentError } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', id)
            .single();

        if (parentError || !parentTask) {
            return res.status(404).json({ error: 'Parent task not found' });
        }

        // Get children
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('parent_task_id', id)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching child tasks:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            children: data || [],
            count: data?.length || 0
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
