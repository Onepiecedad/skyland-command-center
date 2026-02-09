import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables before importing supabase
dotenv.config();

import { supabase } from './services/supabase';
import { getAdapter, type ChatMessage } from './llm/adapter';
import { buildSystemPrompt, CustomerInfo } from './llm/systemPrompt';
import { MASTER_BRAIN_TOOLS, executeToolCall, formatToolResultForLLM } from './llm/tools';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================================
// Health check endpoint - checks if Supabase is reachable
// ============================================================================
app.get('/api/v1/health', async (_req: Request, res: Response) => {
    const time = new Date().toISOString();

    try {
        // Simple query to check Supabase connectivity
        const { error } = await supabase
            .from('customers')
            .select('id')
            .limit(1);

        if (error) {
            console.error('Health check: Supabase query failed:', error);
            return res.json({
                ok: false,
                supabase: { ok: false },
                time
            });
        }

        return res.json({
            ok: true,
            supabase: { ok: true },
            time
        });
    } catch (err) {
        console.error('Health check: Unexpected error:', err);
        return res.json({
            ok: false,
            supabase: { ok: false },
            time
        });
    }
});

// ============================================================================
// Status endpoint - system summary with counts
// ============================================================================
app.get('/api/v1/status', async (_req: Request, res: Response) => {
    const time = new Date().toISOString();
    let supabaseOk = false;
    let customersCount = 0;
    let tasksOpenCount = 0;
    let suggestPendingCount = 0;

    try {
        // Count customers
        const { count: customerCount, error: customerError } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true });

        if (customerError) {
            console.error('Status: Failed to count customers:', customerError);
        } else {
            customersCount = customerCount ?? 0;
            supabaseOk = true;
        }

        // Count open tasks (status IN created, assigned, in_progress, review)
        const { count: openCount, error: openError } = await supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .in('status', ['created', 'assigned', 'in_progress', 'review']);

        if (openError) {
            console.error('Status: Failed to count open tasks:', openError);
            supabaseOk = false;
        } else {
            tasksOpenCount = openCount ?? 0;
        }

        // Count pending suggestions (status = 'review')
        const { count: pendingCount, error: pendingError } = await supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'review');

        if (pendingError) {
            console.error('Status: Failed to count pending suggestions:', pendingError);
            supabaseOk = false;
        } else {
            suggestPendingCount = pendingCount ?? 0;
        }

        return res.json({
            time,
            supabase: { ok: supabaseOk },
            counts: {
                customers: customersCount,
                tasks_open: tasksOpenCount,
                suggest_pending: suggestPendingCount
            }
        });
    } catch (err) {
        console.error('Status: Unexpected error:', err);
        return res.json({
            time,
            supabase: { ok: false },
            counts: {
                customers: 0,
                tasks_open: 0,
                suggest_pending: 0
            }
        });
    }
});

// ============================================================================
// GET /api/v1/customers
// Fetches customers with derived status from customer_status view
// Query params: slug (optional) - filter by slug
// ============================================================================
app.get('/api/v1/customers', async (req: Request, res: Response) => {
    try {
        const { slug } = req.query;

        let query = supabase.from('customer_status').select('*');

        // If slug is provided, filter by it
        if (typeof slug === 'string' && slug.length > 0) {
            query = query.eq('slug', slug);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching customers:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ customers: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/v1/customers/:id
// Fetches a single customer by ID with derived status from customer_status view
// ============================================================================
app.get('/api/v1/customers/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('customer_status')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            // Check if it's a "not found" error
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Customer not found' });
            }
            console.error('Error fetching customer:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ customer: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /api/v1/customers/:id
// Updates only the config field for a customer
// Body: { "config": { ... } }
// ============================================================================
const customerConfigSchema = z.object({
    config: z.record(z.string(), z.unknown())
});

app.put('/api/v1/customers/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Validate request body - only config allowed
        const parsed = customerConfigSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        // First check if customer exists
        const { data: existing, error: checkError } = await supabase
            .from('customers')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Update only the config field
        const { data, error } = await supabase
            .from('customers')
            .update({ config: parsed.data.config })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating customer:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ customer: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/v1/activities
// Fetches activities with pagination and filtering
// Query params: limit, offset, customer_id, agent, event_type, severity, since
// ============================================================================
const activitiesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    customer_id: z.string().uuid().optional(),
    agent: z.string().optional(),
    event_type: z.string().optional(),
    severity: z.enum(['info', 'warn', 'error']).optional(),
    since: z.string().datetime().optional()
});

app.get('/api/v1/activities', async (req: Request, res: Response) => {
    try {
        // Validate query params
        const parsed = activitiesQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { limit, offset, customer_id, agent, event_type, severity, since } = parsed.data;

        // Build query with filters
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

// ============================================================================
// POST /api/v1/activities
// Creates a new activity entry
// ============================================================================
const activitySchema = z.object({
    customer_id: z.union([z.string().uuid(), z.literal(null)]).optional(),
    agent: z.string().min(1),
    action: z.string().min(1),
    event_type: z.string().min(1),
    severity: z.enum(['info', 'warn', 'error']).default('info'),
    autonomy_level: z.enum(['OBSERVE', 'SUGGEST', 'ACT', 'SILENT']).default('OBSERVE'),
    details: z.record(z.string(), z.unknown()).default({}),
});

app.post('/api/v1/activities', async (req: Request, res: Response) => {
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

// ============================================================================
// GET /api/v1/tasks
// Fetches tasks with pagination and filtering
// Query params: limit, offset, customer_id, assigned_agent, status, priority
// ============================================================================
const tasksQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    customer_id: z.string().uuid().optional(),
    assigned_agent: z.string().optional(),
    status: z.enum(['created', 'assigned', 'in_progress', 'review', 'completed', 'failed']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
});

app.get('/api/v1/tasks', async (req: Request, res: Response) => {
    try {
        // Validate query params
        const parsed = tasksQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { limit, offset, customer_id, assigned_agent, status, priority } = parsed.data;

        // Build query with filters
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

// ============================================================================
// POST /api/v1/tasks
// Creates a new task
// ============================================================================
const createTaskSchema = z.object({
    customer_id: z.union([z.string().uuid(), z.literal(null)]).optional(),
    parent_task_id: z.union([z.string().uuid(), z.literal(null)]).optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    assigned_agent: z.string().optional(),
    executor: z.string().default('local:echo'),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    status: z.enum(['created', 'assigned', 'in_progress', 'review', 'completed', 'failed']).default('created'),
    input: z.record(z.string(), z.unknown()).default({})
});

app.post('/api/v1/tasks', async (req: Request, res: Response) => {
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

// ============================================================================
// PUT /api/v1/tasks/:id
// Updates a task (only allowed fields: status, assigned_agent, output, priority, description)
// Title is immutable in v1
// ============================================================================
const updateTaskSchema = z.object({
    status: z.enum(['created', 'assigned', 'in_progress', 'review', 'completed', 'failed']).optional(),
    assigned_agent: z.string().optional(),
    output: z.record(z.string(), z.unknown()).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    description: z.string().optional()
});

app.put('/api/v1/tasks/:id', async (req: Request, res: Response) => {
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

// ============================================================================
// POST /api/v1/tasks/:id/approve
// ============================================================================
// GET /api/v1/tasks/:id
// Gets a single task by ID
// ============================================================================
app.get('/api/v1/tasks/:id', async (req: Request, res: Response) => {
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

// ============================================================================
// POST /api/v1/tasks/:id/approve
// Approves a SUGGEST task (status must be 'review')
// Sets approved_by, approved_at, and changes status to assigned/in_progress
// ============================================================================
const approveTaskSchema = z.object({
    approved_by: z.string().min(1)
});

app.post('/api/v1/tasks/:id/approve', async (req: Request, res: Response) => {
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

// ============================================================================
// GET /api/v1/tasks/:id/children
// Lists child tasks for a given parent task
// ============================================================================
app.get('/api/v1/tasks/:id/children', async (req: Request, res: Response) => {
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

// ============================================================================
// GET /api/v1/tasks/:id/runs
// Lists run history for a given task
// ============================================================================
app.get('/api/v1/tasks/:id/runs', async (req: Request, res: Response) => {
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

// ============================================================================
// GET /api/v1/runs
// Global task runs endpoint with filters (Ticket 15)
// Query params: limit (default 20, max 100), status (comma-separated), executorPrefix
// ============================================================================
const globalRunsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.string().optional(),
    executorPrefix: z.string().optional()
});

app.get('/api/v1/runs', async (req: Request, res: Response) => {
    try {
        const parsed = globalRunsQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { limit, status, executorPrefix } = parsed.data;

        // Build query
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

// ============================================================================
// DISPATCHER SYSTEM - Ticket 12
// ============================================================================

// Rate limit configuration (Ticket 20)
const CLAW_MAX_CONCURRENT_PER_CUSTOMER = parseInt(process.env.CLAW_MAX_CONCURRENT_PER_CUSTOMER || '3', 10);
const CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER = parseInt(process.env.CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER || '20', 10);
const CLAW_MAX_RUNS_PER_HOUR_GLOBAL = parseInt(process.env.CLAW_MAX_RUNS_PER_HOUR_GLOBAL || '60', 10);

// Claw executor allowlist (Ticket 19)
const CLAW_EXECUTOR_ALLOWLIST = ['claw:research', 'claw:prospect-finder', 'claw:content', 'claw:deep-research', 'claw:report-writer'];

// Dispatch request schema
const dispatchSchema = z.object({
    worker_id: z.string().default('backend-dispatcher-v0')
});

// Dispatch result type
interface DispatchResult {
    success: boolean;
    task: Record<string, unknown>;
    run: Record<string, unknown>;
    error?: string;
    rateLimited?: boolean;
}

// Helper: Log activity for task runs
async function logTaskRunActivity(
    customerId: string | null,
    taskId: string,
    runId: string,
    action: 'run_started' | 'run_completed' | 'run_failed' | 'run_timeout',
    severity: 'info' | 'error' | 'warn',
    details: Record<string, unknown> = {}
) {
    try {
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'system:reaper',
            event_type: 'task_run',
            action,
            severity,
            details: { task_id: taskId, run_id: runId, message: `Task run ${action.replace('run_', '')}`, ...details }
        });
    } catch (err) {
        console.error('Failed to log activity:', err);
    }
}

// Helper: Log rate_limited activity (Ticket 20)
async function logRateLimitedActivity(
    customerId: string | null,
    taskId: string,
    reason: 'concurrent_limit' | 'hourly_limit',
    details: Record<string, unknown> = {}
) {
    try {
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'system:dispatcher',
            event_type: 'rate_limit',
            action: 'rate_limited',
            severity: 'warn',
            details: { task_id: taskId, reason, message: `Task dispatch rate limited: ${reason}`, ...details }
        });
    } catch (err) {
        console.error('Failed to log rate_limited activity:', err);
    }
}

// Rate limit result type
interface RateLimitResult {
    allowed: boolean;
    reason?: 'concurrent_limit' | 'hourly_limit';
    details?: Record<string, unknown>;
}

// Helper: Check claw rate limits before dispatch (Ticket 20)
async function checkClawRateLimits(customerId: string | null, executor: string): Promise<RateLimitResult> {
    // Only apply rate limits to claw executors
    if (!executor.startsWith('claw:')) {
        return { allowed: true };
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    try {
        // Check concurrent running runs for this customer
        if (customerId) {
            const { count: concurrentCount, error: concurrentError } = await supabase
                .from('task_runs')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'running')
                .like('executor', 'claw:%')
                .eq('task_id', customerId); // Join via tasks table

            // More accurate: query via tasks table
            const { data: runningTasks, error: runningError } = await supabase
                .from('tasks')
                .select('id, task_runs!inner(id, status)')
                .eq('customer_id', customerId)
                .like('executor', 'claw:%');

            if (!runningError && runningTasks) {
                const runningCount = runningTasks.filter((t: Record<string, unknown>) => {
                    const runs = t.task_runs as Array<Record<string, unknown>>;
                    return runs?.some(r => r.status === 'running');
                }).length;

                if (runningCount >= CLAW_MAX_CONCURRENT_PER_CUSTOMER) {
                    return {
                        allowed: false,
                        reason: 'concurrent_limit',
                        details: {
                            customer_id: customerId,
                            current: runningCount,
                            limit: CLAW_MAX_CONCURRENT_PER_CUSTOMER
                        }
                    };
                }
            }

            // Check hourly limit per customer
            const { count: hourlyCustomerCount, error: hourlyCustomerError } = await supabase
                .from('task_runs')
                .select('id, tasks!inner(customer_id)', { count: 'exact', head: true })
                .like('executor', 'claw:%')
                .gte('queued_at', oneHourAgo)
                .eq('tasks.customer_id', customerId);

            if (!hourlyCustomerError && hourlyCustomerCount !== null && hourlyCustomerCount >= CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER) {
                return {
                    allowed: false,
                    reason: 'hourly_limit',
                    details: {
                        customer_id: customerId,
                        current: hourlyCustomerCount,
                        limit: CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER,
                        window: '1 hour'
                    }
                };
            }
        }

        // Check global hourly limit
        const { count: globalCount, error: globalError } = await supabase
            .from('task_runs')
            .select('id', { count: 'exact', head: true })
            .like('executor', 'claw:%')
            .gte('queued_at', oneHourAgo);

        if (!globalError && globalCount !== null && globalCount >= CLAW_MAX_RUNS_PER_HOUR_GLOBAL) {
            return {
                allowed: false,
                reason: 'hourly_limit',
                details: {
                    scope: 'global',
                    current: globalCount,
                    limit: CLAW_MAX_RUNS_PER_HOUR_GLOBAL,
                    window: '1 hour'
                }
            };
        }

        return { allowed: true };
    } catch (err) {
        console.error('[rate-limit] Error checking rate limits:', err);
        // On error, allow dispatch (fail open)
        return { allowed: true };
    }
}

// ============================================================================
// Reaper: Timeout stuck running task_runs
// ============================================================================
async function reapStuckRuns() {
    const timeoutMinutes = parseInt(process.env.TASK_RUN_TIMEOUT_MINUTES || '15', 10);
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

    try {
        // Find stuck runs: status='running' AND started_at < cutoff
        const { data: stuckRuns, error } = await supabase
            .from('task_runs')
            .select('id, task_id, started_at, tasks(customer_id, status)')
            .eq('status', 'running')
            .lt('started_at', cutoff);

        if (error) {
            console.error('[reaper] Error querying stuck runs:', error);
            return;
        }

        if (!stuckRuns?.length) return;

        console.log(`[reaper] Found ${stuckRuns.length} stuck run(s) to timeout`);

        for (const run of stuckRuns) {
            const now = new Date().toISOString();
            const durationMs = Date.now() - new Date(run.started_at).getTime();
            // Supabase returns tasks as array for foreign key relation
            const taskInfo = Array.isArray(run.tasks) ? run.tasks[0] : run.tasks as { customer_id: string | null; status: string } | null;

            // Update run → timeout
            const { error: runError } = await supabase
                .from('task_runs')
                .update({
                    status: 'timeout',
                    ended_at: now,
                    error: { code: 'timeout', message: `Run timed out after ${timeoutMinutes} minutes` },
                    metrics: { duration_ms: durationMs }
                })
                .eq('id', run.id);

            if (runError) {
                console.error(`[reaper] Failed to update run ${run.id}:`, runError);
                continue;
            }

            // Update task → failed (if still in_progress)
            if (taskInfo?.status === 'in_progress') {
                await supabase
                    .from('tasks')
                    .update({ status: 'failed' })
                    .eq('id', run.task_id);
            }

            // Log activity
            await logTaskRunActivity(
                taskInfo?.customer_id || null,
                run.task_id,
                run.id,
                'run_timeout',
                'warn',
                { timeout_minutes: timeoutMinutes, duration_ms: durationMs }
            );

            console.log(`[reaper] Run ${run.id} marked as timeout (was running for ${Math.round(durationMs / 1000 / 60)}m)`);
        }
    } catch (err) {
        console.error('[reaper] Unexpected error:', err);
    }
}

// ============================================================================
// Admin: One-shot zombie cleanup
// ============================================================================
app.post('/api/v1/admin/reaper/run-timeouts', async (req: Request, res: Response) => {
    try {
        const { olderThanMinutes } = req.body;

        if (typeof olderThanMinutes !== 'number' || olderThanMinutes < 1) {
            return res.status(400).json({
                error: 'olderThanMinutes must be a positive number'
            });
        }

        const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
        console.log(`[admin-reaper] One-shot cleanup: timing out runs older than ${olderThanMinutes}m (cutoff: ${cutoff})`);

        // Find stuck runs
        const { data: stuckRuns, error } = await supabase
            .from('task_runs')
            .select('id, task_id, started_at, tasks(customer_id, status)')
            .eq('status', 'running')
            .lt('started_at', cutoff);

        if (error) {
            console.error('[admin-reaper] Error querying stuck runs:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!stuckRuns?.length) {
            return res.json({ updatedRuns: 0, message: 'No stuck runs found' });
        }

        console.log(`[admin-reaper] Found ${stuckRuns.length} stuck run(s) to timeout`);
        let updatedCount = 0;

        for (const run of stuckRuns) {
            const now = new Date().toISOString();
            const durationMs = Date.now() - new Date(run.started_at).getTime();
            const taskInfo = Array.isArray(run.tasks) ? run.tasks[0] : run.tasks as { customer_id: string | null; status: string } | null;

            // Update run → timeout
            const { error: runError } = await supabase
                .from('task_runs')
                .update({
                    status: 'timeout',
                    ended_at: now,
                    error: { code: 'timeout', message: `Run timed out (zombie cleanup, threshold: ${olderThanMinutes}m)` },
                    metrics: { duration_ms: durationMs }
                })
                .eq('id', run.id);

            if (runError) {
                console.error(`[admin-reaper] Failed to update run ${run.id}:`, runError);
                continue;
            }

            // Update task → failed (if still in_progress)
            if (taskInfo?.status === 'in_progress') {
                await supabase
                    .from('tasks')
                    .update({ status: 'failed' })
                    .eq('id', run.task_id);
            }

            // Log activity
            await logTaskRunActivity(
                taskInfo?.customer_id || null,
                run.task_id,
                run.id,
                'run_timeout',
                'warn',
                { timeout_minutes: olderThanMinutes, duration_ms: durationMs, cleanup: 'admin-one-shot' }
            );

            updatedCount++;
            console.log(`[admin-reaper] Run ${run.id} marked as timeout (was running for ${Math.round(durationMs / 1000 / 60)}m)`);
        }

        return res.json({
            updatedRuns: updatedCount,
            message: `Timed out ${updatedCount} zombie run(s)`
        });
    } catch (err) {
        console.error('[admin-reaper] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper: Execute local:echo - returns input as output
async function executeLocalEcho(task: Record<string, unknown>): Promise<{ output: Record<string, unknown>; error?: string }> {
    return {
        output: {
            echo: true,
            input_received: task.input,
            executor: task.executor,
            message: 'Local echo completed successfully'
        }
    };
}

// Helper: Execute n8n webhook
async function executeN8nWebhook(task: Record<string, unknown>, runId: string): Promise<{ triggered: boolean; error?: string }> {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    if (!webhookUrl) {
        return { triggered: false, error: 'N8N_WEBHOOK_URL not configured' };
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                task_id: task.id,
                run_id: runId,
                executor: task.executor,
                title: task.title,
                input: task.input,
                customer_id: task.customer_id,
                callback_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/v1/n8n/task-result`
            })
        });

        if (!response.ok) {
            return { triggered: false, error: `Webhook returned ${response.status}` };
        }

        return { triggered: true };
    } catch (err) {
        return { triggered: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

// Helper: Execute claw webhook (Ticket 19 - async like n8n)
async function executeClawWebhook(
    task: Record<string, unknown>,
    runId: string
): Promise<{ triggered: boolean; error?: string }> {
    const hookUrl = process.env.OPENCLAW_HOOK_URL;
    const hookToken = process.env.OPENCLAW_HOOK_TOKEN;
    const publicBaseUrl = process.env.SCC_PUBLIC_BASE_URL || process.env.BACKEND_URL || 'http://localhost:3001';

    if (!hookUrl) {
        return { triggered: false, error: 'OPENCLAW_HOOK_URL not configured' };
    }

    // Extract agent_id from executor (claw:research → research)
    const agentId = (task.executor as string).replace('claw:', '');

    try {
        const response = await fetch(hookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(hookToken ? { 'Authorization': `Bearer ${hookToken}` } : {})
            },
            body: JSON.stringify({
                task_id: task.id,
                run_id: runId,
                agent_id: agentId,
                prompt: task.title,
                input: task.input,
                customer_id: task.customer_id,
                callback_url: `${publicBaseUrl}/api/v1/claw/task-result`
            })
        });

        if (!response.ok) {
            return { triggered: false, error: `OpenClaw hook returned ${response.status}` };
        }

        console.log(`[claw-dispatch] Triggered ${agentId} for task ${task.id}, run ${runId}`);
        return { triggered: true };
    } catch (err) {
        return { triggered: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

// Core dispatcher function
async function dispatchTask(taskId: string, workerId: string): Promise<DispatchResult> {
    // 1. Get task and validate status
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

    if (fetchError || !task) {
        return { success: false, task: {}, run: {}, error: 'Task not found' };
    }

    // Only dispatch from assigned or created status
    if (!['assigned', 'created'].includes(task.status)) {
        return {
            success: false,
            task,
            run: {},
            error: `Cannot dispatch task with status '${task.status}'. Expected 'assigned' or 'created'.`
        };
    }

    // 2. Check rate limits for claw executors (Ticket 20)
    const rateLimitResult = await checkClawRateLimits(task.customer_id, task.executor);
    if (!rateLimitResult.allowed) {
        // Log rate limited activity
        await logRateLimitedActivity(
            task.customer_id,
            taskId,
            rateLimitResult.reason as 'concurrent_limit' | 'hourly_limit',
            rateLimitResult.details
        );

        // Update task with rate limit info (keep in assigned status)
        await supabase
            .from('tasks')
            .update({
                rate_limited_at: new Date().toISOString(),
                rate_limit_reason: rateLimitResult.reason
            })
            .eq('id', taskId);

        console.log(`[rate-limit] Task ${taskId} rate limited: ${rateLimitResult.reason}`);

        return {
            success: false,
            task: { ...task, rate_limited_at: new Date().toISOString(), rate_limit_reason: rateLimitResult.reason },
            run: {},
            error: `Rate limited: ${rateLimitResult.reason}`,
            rateLimited: true
        } as DispatchResult;
    }

    // 3. Get next run number
    const { data: lastRun } = await supabase
        .from('task_runs')
        .select('run_number')
        .eq('task_id', taskId)
        .order('run_number', { ascending: false })
        .limit(1)
        .single();

    const runNumber = (lastRun?.run_number || 0) + 1;

    // 3. Create task_run with status 'running'
    const { data: run, error: runError } = await supabase
        .from('task_runs')
        .insert({
            task_id: taskId,
            run_number: runNumber,
            executor: task.executor,
            status: 'running',
            worker_id: workerId,
            input_snapshot: task.input,
            queued_at: new Date().toISOString(),
            started_at: new Date().toISOString()
        })
        .select()
        .single();

    if (runError || !run) {
        return { success: false, task, run: {}, error: `Failed to create run: ${runError?.message}` };
    }

    // 4. Atomic transition: task status → in_progress
    const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'in_progress' })
        .eq('id', taskId)
        .select()
        .single();

    if (updateError) {
        return { success: false, task, run, error: `Failed to update task: ${updateError.message}` };
    }

    // 5. Log run_started
    await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_started', 'info', {
        executor: task.executor,
        worker_id: workerId,
        run_number: runNumber
    });

    // 6. Execute based on executor type
    const executor = task.executor || 'local:echo';

    if (executor.startsWith('local:echo')) {
        // Synchronous execution
        const result = await executeLocalEcho(task);

        // Update run with result
        await supabase
            .from('task_runs')
            .update({
                status: 'completed',
                output: result.output,
                ended_at: new Date().toISOString()
            })
            .eq('id', run.id);

        // Update task status
        const { data: finalTask } = await supabase
            .from('tasks')
            .update({ status: 'completed', output: result.output })
            .eq('id', taskId)
            .select()
            .single();

        // Log completion
        await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_completed', 'info', {
            executor,
            duration_ms: Date.now() - new Date(run.started_at).getTime()
        });

        return { success: true, task: finalTask || updatedTask, run: { ...run, status: 'completed', output: result.output } };

    } else if (executor.startsWith('n8n:')) {
        // Async execution via webhook
        const result = await executeN8nWebhook(task, run.id);

        if (!result.triggered) {
            // Failed to trigger - mark as failed
            await supabase
                .from('task_runs')
                .update({
                    status: 'failed',
                    error: result.error,
                    ended_at: new Date().toISOString()
                })
                .eq('id', run.id);

            await supabase
                .from('tasks')
                .update({ status: 'failed' })
                .eq('id', taskId);

            await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
                executor,
                error: result.error
            });

            return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: result.error }, error: result.error };
        }

        // Webhook triggered successfully - task stays in_progress until callback
        return { success: true, task: updatedTask, run: { ...run, status: 'running' } };

    } else if (executor.startsWith('claw:')) {
        // Ticket 19: Claw executor with allowlist check
        if (!CLAW_EXECUTOR_ALLOWLIST.includes(executor)) {
            // Not in allowlist - fail immediately
            const errorMsg = `Claw executor not allowed: ${executor}. Allowed: ${CLAW_EXECUTOR_ALLOWLIST.join(', ')}`;

            await supabase
                .from('task_runs')
                .update({
                    status: 'failed',
                    error: { code: 'claw_executor_not_allowed', message: errorMsg },
                    ended_at: new Date().toISOString()
                })
                .eq('id', run.id);

            await supabase
                .from('tasks')
                .update({ status: 'failed' })
                .eq('id', taskId);

            await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
                executor,
                error: errorMsg,
                error_code: 'claw_executor_not_allowed'
            });

            return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: errorMsg }, error: errorMsg };
        }

        // Allowed executor - async webhook execution (like n8n)
        const result = await executeClawWebhook(task, run.id);

        if (!result.triggered) {
            // Failed to trigger - mark as failed
            await supabase
                .from('task_runs')
                .update({
                    status: 'failed',
                    error: { code: 'claw_trigger_failed', message: result.error },
                    ended_at: new Date().toISOString()
                })
                .eq('id', run.id);

            await supabase
                .from('tasks')
                .update({ status: 'failed' })
                .eq('id', taskId);

            await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
                executor,
                error: result.error
            });

            return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: result.error }, error: result.error };
        }

        // Webhook triggered successfully - task stays in_progress until callback
        return { success: true, task: updatedTask, run: { ...run, status: 'running' } };

    } else {
        // Unknown executor
        const errorMsg = `Unknown executor type: ${executor}`;

        await supabase
            .from('task_runs')
            .update({
                status: 'failed',
                error: errorMsg,
                ended_at: new Date().toISOString()
            })
            .eq('id', run.id);

        await supabase
            .from('tasks')
            .update({ status: 'failed' })
            .eq('id', taskId);

        await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
            executor,
            error: errorMsg
        });

        return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: errorMsg }, error: errorMsg };
    }
}

// ============================================================================
// POST /api/v1/tasks/:id/dispatch
// Dispatches a task for execution
// ============================================================================
app.post('/api/v1/tasks/:id/dispatch', async (req: Request, res: Response) => {
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

// ============================================================================
// POST /api/v1/n8n/task-result
// Callback endpoint for n8n to report task completion
// ============================================================================
const n8nCallbackSchema = z.object({
    task_id: z.string().uuid(),
    run_id: z.string().uuid(),
    success: z.boolean(),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional()
});

app.post('/api/v1/n8n/task-result', async (req: Request, res: Response) => {
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
            // Don't fail the whole request, but log it
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

// ============================================================================
// POST /api/v1/claw/task-result
// Callback endpoint for OpenClaw to report task completion (Ticket 19)
// ============================================================================

// Output schema for claw:research (Ticket 20 - best effort validation)
const clawResearchOutputSchema = z.object({
    summary: z.string(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
    frameworks: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        link: z.string().optional(),
        what_it_is: z.string().optional(),
        strengths: z.array(z.string()).optional(),
        good_for: z.array(z.string()).optional()
    })).optional(),
    key_trends_2024: z.array(z.string()).optional(),
    selection_guide: z.array(z.object({
        pick: z.string(),
        if_you_need: z.string()
    })).optional(),
    generated_at: z.string().optional(),
    topic: z.string().optional(),
    depth: z.string().optional(),
    notes: z.string().optional()
}).passthrough();

const clawCallbackSchema = z.object({
    task_id: z.string().uuid(),
    run_id: z.string().uuid(),
    success: z.boolean(),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional()
});

app.post('/api/v1/claw/task-result', async (req: Request, res: Response) => {
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
            // Don't fail the whole request, but log it
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

// ============================================================================
// CHAT ENDPOINT - Master Brain Stub
// ============================================================================

// Chat request schema (Ticket 21 - updated with customer_id)
const chatRequestSchema = z.object({
    message: z.string().min(1),
    customer_id: z.string().uuid().optional(),
    channel: z.enum(['chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook']).default('chat'),
    conversation_id: z.string().uuid().optional()
});

// Number of previous messages to include in context
const CHAT_CONTEXT_MESSAGE_LIMIT = 10;

// Helper: Log message to messages table
async function logMessage(params: {
    conversation_id: string;
    role: 'user' | 'assistant' | 'system';
    channel: string;
    direction: 'internal' | 'inbound' | 'outbound';
    content: string;
    customer_id?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const { error } = await supabase
        .from('messages')
        .insert({
            conversation_id: params.conversation_id,
            role: params.role,
            channel: params.channel,
            direction: params.direction,
            content: params.content,
            customer_id: params.customer_id ?? null,
            metadata: params.metadata ?? {}
        });

    if (error) {
        console.error('Error logging message:', error);
    }
}

// Helper: Load customers for system prompt
async function loadCustomersForPrompt(): Promise<CustomerInfo[]> {
    const { data, error } = await supabase
        .from('customers')
        .select('id, name, slug');

    if (error || !data) {
        console.error('Error loading customers for prompt:', error);
        return [];
    }

    return data;
}

// Helper: Load recent messages for context
async function loadRecentMessages(
    conversationId: string | null,
    limit: number = CHAT_CONTEXT_MESSAGE_LIMIT
): Promise<ChatMessage[]> {
    let query = supabase
        .from('messages')
        .select('role, content, created_at')
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: false })
        .limit(limit);

    if (conversationId) {
        query = query.eq('conversation_id', conversationId);
    }

    const { data, error } = await query;

    if (error || !data) {
        return [];
    }

    // Reverse to get chronological order and map to ChatMessage format
    return data.reverse().map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
    }));
}

// POST /api/v1/chat - Main chat endpoint (Ticket 21 - LLM Integration)
app.post('/api/v1/chat', async (req: Request, res: Response) => {
    try {
        // Validate request
        const parsed = chatRequestSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { message, channel, customer_id: providedCustomerId } = parsed.data;
        const conversation_id = parsed.data.conversation_id ?? crypto.randomUUID();

        // Track actions for response
        const actions_taken: Array<{ action: string; table: string; details?: Record<string, unknown> }> = [];
        const proposed_actions: unknown[] = [];

        // Use provided customer_id or null
        const customerId = providedCustomerId || null;

        // Log chat_received activity
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'master_brain',
            action: 'chat_received',
            event_type: 'chat',
            severity: 'info',
            details: { conversation_id, channel, message_length: message.length }
        });
        actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'chat_received' } });

        // Log inbound user message
        await logMessage({
            conversation_id,
            role: 'user',
            channel,
            direction: 'internal',
            content: message,
            customer_id: customerId
        });
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'user', conversation_id } });

        // Load context for LLM
        const [customers, previousMessages] = await Promise.all([
            loadCustomersForPrompt(),
            loadRecentMessages(conversation_id)
        ]);

        // Build system prompt with customer data
        const systemPrompt = buildSystemPrompt(customers);

        // Build messages for LLM (previous context + current message)
        const llmMessages: ChatMessage[] = [
            ...previousMessages.slice(0, -1), // Exclude the message we just logged (it's already the current one)
            { role: 'user', content: message }
        ];

        // Get LLM adapter
        let adapter;
        try {
            adapter = getAdapter();
        } catch (adapterError) {
            console.error('Failed to initialize LLM adapter:', adapterError);
            return res.status(500).json({
                error: 'LLM adapter not configured',
                details: adapterError instanceof Error ? adapterError.message : 'Unknown error'
            });
        }

        // Call LLM
        let llmResponse;
        try {
            llmResponse = await adapter.chat({
                systemPrompt,
                messages: llmMessages,
                tools: MASTER_BRAIN_TOOLS
            });
        } catch (llmError) {
            console.error('LLM call failed:', llmError);
            return res.status(500).json({
                error: 'LLM call failed',
                details: llmError instanceof Error ? llmError.message : 'Unknown error'
            });
        }

        // Process tool calls if present (single round, v1 scope)
        let responseText = llmResponse.text;
        const toolResults: Array<{ name: string; result: unknown }> = [];

        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
            console.log(`[chat] Processing ${llmResponse.toolCalls.length} tool calls`);

            for (const toolCall of llmResponse.toolCalls) {
                console.log(`[chat] Executing tool: ${toolCall.name}`);
                const result = await executeToolCall(toolCall.name, toolCall.arguments);
                toolResults.push({ name: toolCall.name, result });

                // If task was created, add to proposed_actions
                if (toolCall.name === 'create_task_proposal' && result.success) {
                    const taskData = result.data as { task_id: string; title: string };
                    proposed_actions.push({
                        type: 'TASK_CREATED',
                        task_id: taskData.task_id,
                        title: taskData.title
                    });

                    // Log task_proposed activity
                    await supabase.from('activities').insert({
                        customer_id: customerId,
                        agent: 'master_brain',
                        action: 'task_proposed',
                        event_type: 'task',
                        severity: 'info',
                        details: {
                            conversation_id,
                            task_id: taskData.task_id,
                            title: taskData.title
                        }
                    });
                    actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'task_proposed', task_id: taskData.task_id } });
                }

                // Append formatted tool result to response if LLM didn't provide text
                if (!responseText) {
                    responseText = formatToolResultForLLM(toolCall.name, result);
                }
            }

            // CRITICAL: Send tool results back to LLM for a natural language response
            // This ensures the user gets a human-readable answer, not raw JSON
            if (toolResults.length > 0) {
                console.log(`[chat] Sending ${toolResults.length} tool results back to LLM for natural response`);

                // Build tool result messages
                const toolResultMessages: ChatMessage[] = [
                    ...llmMessages,
                    {
                        role: 'assistant' as const,
                        content: `Jag har hämtat data med verktyg: ${toolResults.map(t => t.name).join(', ')}`
                    },
                    {
                        role: 'user' as const,
                        content: `Verktygsdata:\n${toolResults.map(tr =>
                            `${tr.name}: ${JSON.stringify(tr.result, null, 2)}`
                        ).join('\n\n')}\n\nSammanfatta detta på ENKEL SVENSKA. Förklara för en person som INTE kan programmera vad som hänt och varför. Inga JSON-objekt eller teknisk kod i svaret!`
                    }
                ];

                try {
                    const followUpResponse = await adapter.chat({
                        systemPrompt,
                        messages: toolResultMessages,
                        tools: [] // No tools in follow-up, just generate text
                    });

                    if (followUpResponse.text) {
                        responseText = followUpResponse.text;
                    }
                } catch (followUpError) {
                    console.error('Follow-up LLM call failed:', followUpError);
                    // Keep the formatted tool result as fallback
                }
            }

            // If LLM provided text AND we have tool results, append tool results
            if (llmResponse.text && toolResults.length > 0) {
                const toolSummaries = toolResults
                    .map(tr => formatToolResultForLLM(tr.name, tr.result as { success: boolean; data?: unknown; error?: string }))
                    .join('\n\n');
                // LLM text already includes the response, just ensure it's complete
                responseText = llmResponse.text;
            }
        }

        // Fallback if no response
        if (!responseText) {
            responseText = 'Jag kunde inte generera ett svar. Vänligen försök igen eller omformulera din fråga.';
        }

        // Log outbound assistant message
        await logMessage({
            conversation_id,
            role: 'assistant',
            channel,
            direction: 'internal',
            content: responseText,
            customer_id: customerId,
            metadata: {
                tool_calls: llmResponse.toolCalls?.map(tc => tc.name) || [],
                tool_results: toolResults.length
            }
        });
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'assistant', conversation_id } });

        // Log chat_responded activity
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'master_brain',
            action: 'chat_responded',
            event_type: 'chat',
            severity: 'info',
            autonomy_level: proposed_actions.length > 0 ? 'SUGGEST' : 'OBSERVE',
            details: {
                conversation_id,
                channel,
                response_length: responseText.length,
                tool_calls_count: llmResponse.toolCalls?.length || 0,
                has_proposed_actions: proposed_actions.length > 0
            }
        });
        actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'chat_responded' } });

        // Return response
        return res.json({
            response: responseText,
            conversation_id,
            customer_id: customerId,
            actions_taken,
            proposed_actions,
            tool_calls: llmResponse.toolCalls?.map(tc => tc.name) || []
        });

    } catch (err) {
        console.error('Chat error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/v1/chat/history - Fetch messages for a conversation
// ============================================================================
app.get('/api/v1/chat/history', async (req: Request, res: Response) => {
    try {
        const { conversation_id } = req.query;

        if (!conversation_id || typeof conversation_id !== 'string') {
            return res.status(400).json({ error: 'conversation_id is required' });
        }

        // Validate UUID format
        const uuidSchema = z.string().uuid();
        const uuidParsed = uuidSchema.safeParse(conversation_id);

        if (!uuidParsed.success) {
            return res.status(400).json({ error: 'Invalid conversation_id format' });
        }

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching chat history:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ messages: data, conversation_id });

    } catch (err) {
        console.error('Chat history error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/v1/reports/:task_id - Download report PDF for a task (Ticket 22)
// ============================================================================

app.get('/api/v1/reports/:task_id', async (req: Request, res: Response) => {
    try {
        const taskId = req.params.task_id as string;

        // Validate UUID format
        const uuidSchema = z.string().uuid();
        const uuidParsed = uuidSchema.safeParse(taskId);

        if (!uuidParsed.success) {
            return res.status(400).json({ error: 'Invalid task_id format' });
        }

        // Get task to find report path
        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .select('output, status, title')
            .eq('id', taskId)
            .single();

        if (taskError || !task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        if (task.status !== 'completed') {
            return res.status(400).json({ error: 'Report not yet generated', status: task.status });
        }

        // Check for report path in output
        const output = task.output as Record<string, unknown> | null;
        const reportPath = (output?.report_path || output?.desktop_path) as string | null;

        if (!reportPath) {
            // Try default path based on task ID
            const defaultPath = path.join(
                process.env.HOME || '/Users/onepiecedad',
                '.openclaw/output',
                taskId,
                'rapport.pdf'
            );

            if (fs.existsSync(defaultPath)) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${task.title || 'rapport'}.pdf"`);
                return fs.createReadStream(defaultPath).pipe(res);
            }

            return res.status(404).json({ error: 'Report file not found', checked_path: defaultPath });
        }

        // Serve the PDF file
        const absolutePath = reportPath.replace('~', process.env.HOME || '/Users/onepiecedad');

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ error: 'Report file not found', path: reportPath });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${task.title || 'rapport'}.pdf"`);
        return fs.createReadStream(absolutePath).pipe(res);

    } catch (err) {
        console.error('Report download error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/v1/tasks/:id/progress
// Returns current progress for a task from latest running/completed run
// ============================================================================
app.get('/api/v1/tasks/:id/progress', async (req: Request, res: Response) => {
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

// ============================================================================
// POST /api/v1/tasks/:id/progress
// Updates progress for a running task
// ============================================================================
const progressDataSchema = z.object({
    percent: z.number().min(0).max(100).optional(),
    current_step: z.string().optional(),
    steps: z.array(z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(['pending', 'running', 'completed', 'failed'])
    })).optional()
});

const progressSchema = z.object({
    progress: progressDataSchema
});

app.post('/api/v1/tasks/:id/progress', async (req: Request, res: Response) => {
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

// ============================================================================
// COST TRACKING ENDPOINTS
// ============================================================================

// Budget constant (later could be moved to a settings table)
const COST_BUDGET_USD = 150;

// GET /api/v1/costs?range=7d|30d
// Returns aggregated cost data for the Cost Center dashboard
const costsQuerySchema = z.object({
    range: z.enum(['7d', '30d']).default('30d')
});

app.get('/api/v1/costs', async (req: Request, res: Response) => {
    try {
        const parsed = costsQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { range } = parsed.data;
        const days = range === '7d' ? 7 : 30;
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split('T')[0];

        // Fetch all cost rows for the date range
        const { data: rows, error } = await supabase
            .from('costs')
            .select('date, provider, agent, cost_usd, call_count')
            .gte('date', sinceStr)
            .order('date', { ascending: true });

        if (error) {
            console.error('Error fetching costs:', error);
            return res.status(500).json({ error: error.message });
        }

        const costRows = rows || [];

        // Provider colors (must match frontend)
        const PROVIDER_COLORS: Record<string, string> = {
            openrouter: '#8B5CF6',
            openai: '#10B981',
            exa: '#0A84FF',
            firecrawl: '#FF6B35',
            anthropic: '#D97706',
            other: '#64748B',
        };

        // --- Aggregate by date ---
        const dailyMap = new Map<string, { total: number; providers: Record<string, number> }>();
        for (const row of costRows) {
            const d = row.date;
            if (!dailyMap.has(d)) {
                dailyMap.set(d, { total: 0, providers: {} });
            }
            const entry = dailyMap.get(d)!;
            const cost = Number(row.cost_usd);
            entry.total += cost;
            entry.providers[row.provider] = (entry.providers[row.provider] || 0) + cost;
        }

        // Fill in missing dates with zeros
        const daily: Array<{ date: string; total: number; providers: Record<string, number> }> = [];
        const cursor = new Date(since);
        const today = new Date();
        while (cursor <= today) {
            const dateStr = cursor.toISOString().split('T')[0];
            const entry = dailyMap.get(dateStr);
            daily.push({
                date: dateStr,
                total: entry ? +entry.total.toFixed(2) : 0,
                providers: entry ? Object.fromEntries(
                    Object.entries(entry.providers).map(([k, v]) => [k, +v.toFixed(2)])
                ) : {}
            });
            cursor.setDate(cursor.getDate() + 1);
        }

        // --- Aggregate by provider ---
        const providerTotals: Record<string, number> = {};
        for (const row of costRows) {
            providerTotals[row.provider] = (providerTotals[row.provider] || 0) + Number(row.cost_usd);
        }

        const grandTotal = Object.values(providerTotals).reduce((a, b) => a + b, 0);

        const providers = Object.entries(providerTotals)
            .map(([provider, total]) => ({
                provider,
                total: +total.toFixed(2),
                percentage: grandTotal > 0 ? +((total / grandTotal) * 100).toFixed(1) : 0,
                color: PROVIDER_COLORS[provider] || PROVIDER_COLORS.other,
            }))
            .sort((a, b) => b.total - a.total);

        // --- Aggregate by agent ---
        const agentTotals: Record<string, { total: number; calls: number }> = {};
        for (const row of costRows) {
            if (!agentTotals[row.agent]) {
                agentTotals[row.agent] = { total: 0, calls: 0 };
            }
            agentTotals[row.agent].total += Number(row.cost_usd);
            agentTotals[row.agent].calls += (row.call_count || 1);
        }

        const agents = Object.entries(agentTotals)
            .map(([agent, data]) => ({
                agent,
                total: +data.total.toFixed(2),
                calls: data.calls,
            }))
            .sort((a, b) => b.total - a.total);

        return res.json({
            daily,
            providers,
            agents,
            monthTotal: +grandTotal.toFixed(2),
            budget: COST_BUDGET_USD
        });

    } catch (err) {
        console.error('Unexpected error fetching costs:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/v1/costs - Log a cost entry
const costEntrySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    provider: z.string().min(1),
    model: z.string().optional(),
    agent: z.string().min(1),
    tokens_in: z.number().int().min(0).default(0),
    tokens_out: z.number().int().min(0).default(0),
    cost_usd: z.number().min(0),
    call_count: z.number().int().min(1).default(1),
    task_id: z.string().uuid().optional()
});

app.post('/api/v1/costs', async (req: Request, res: Response) => {
    try {
        const parsed = costEntrySchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { data: created, error } = await supabase
            .from('costs')
            .insert(parsed.data)
            .select()
            .single();

        if (error) {
            console.error('Error inserting cost:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.status(201).json(created);

    } catch (err) {
        console.error('Unexpected error inserting cost:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// Start Reaper Timer
// ============================================================================
const reaperIntervalSeconds = parseInt(process.env.TASK_RUN_REAPER_INTERVAL_SECONDS || '60', 10);
const timeoutMinutes = parseInt(process.env.TASK_RUN_TIMEOUT_MINUTES || '15', 10);
setInterval(reapStuckRuns, reaperIntervalSeconds * 1000);
console.log(`🪓 Reaper started (interval: ${reaperIntervalSeconds}s, timeout: ${timeoutMinutes}m)`);

// ============================================================================
// Start server
// ============================================================================
app.listen(PORT, () => {
    console.log(`🚀 Skyland Command Center API running on port ${PORT}`);
});
