import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables before importing supabase
dotenv.config();

import { supabase } from './services/supabase';

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
    title: z.string().min(1),
    description: z.string().optional(),
    assigned_agent: z.string().optional(),
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
// CHAT ENDPOINT - Master Brain Stub
// ============================================================================

// Chat request schema
const chatRequestSchema = z.object({
    message: z.string().min(1),
    channel: z.enum(['chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook']).default('chat'),
    conversation_id: z.string().uuid().optional()
});

// Intent types
type Intent = 'STATUS_CHECK' | 'SUMMARY' | 'CREATE_TASK' | 'HELP';

// Customer slug mapping (will be used to lookup customer_id)
const CUSTOMER_SLUGS = ['axel', 'gustav', 'thomas'];

// Helper: Classify intent from message (deterministic, no AI)
function classifyIntent(message: string): Intent {
    const lowerMsg = message.toLowerCase();

    // STATUS_CHECK: "hur går det" + customer name
    if (lowerMsg.includes('hur går det')) {
        for (const slug of CUSTOMER_SLUGS) {
            if (lowerMsg.includes(slug)) {
                return 'STATUS_CHECK';
            }
        }
    }

    // SUMMARY: "briefing" or "summary"
    if (lowerMsg.includes('briefing') || lowerMsg.includes('summary') || lowerMsg.includes('sammanfattning')) {
        return 'SUMMARY';
    }

    // CREATE_TASK: starts with "create task:" or contains action words
    if (lowerMsg.startsWith('create task:') ||
        lowerMsg.includes('researcha') ||
        lowerMsg.includes('skriv') ||
        lowerMsg.startsWith('be ')) {
        return 'CREATE_TASK';
    }

    // Default: HELP
    return 'HELP';
}

// Helper: Extract customer slug from message
function extractCustomerSlug(message: string): string | null {
    const lowerMsg = message.toLowerCase();
    for (const slug of CUSTOMER_SLUGS) {
        if (lowerMsg.includes(slug)) {
            return slug;
        }
    }
    return null;
}

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

// POST /api/v1/chat - Main chat endpoint
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

        const { message, channel } = parsed.data;

        // Generate or use provided conversation_id
        const conversation_id = parsed.data.conversation_id ?? crypto.randomUUID();

        // Classify intent
        const intent = classifyIntent(message);

        // Extract customer slug if present
        const customerSlug = extractCustomerSlug(message);

        // Get customer_id if slug found
        let customerId: string | null = null;
        if (customerSlug) {
            const { data: customer } = await supabase
                .from('customers')
                .select('id')
                .eq('slug', customerSlug)
                .single();
            if (customer) {
                customerId = customer.id;
            }
        }

        // Log inbound message
        await logMessage({
            conversation_id,
            role: 'user',
            channel,
            direction: 'internal',
            content: message,
            customer_id: customerId,
            metadata: { intent, entities: { customer_slug: customerSlug } }
        });

        // Track message insert action
        const actions_taken: Array<{ action: string; table: string; details?: Record<string, unknown> }> = [];
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'user', conversation_id } });

        // Initialize response structure
        let responseText = '';
        let data: Record<string, unknown> = {};
        const proposed_actions: unknown[] = [];
        const suggestions: string[] = [];

        // Handle each intent
        switch (intent) {
            case 'HELP': {
                responseText = 'Jag kan hjälpa dig med: statusuppdateringar för kunder (fråga "hur går det för [namn]?"), sammanfattningar (säg "briefing" eller "summary"), samt skapa uppgifter (börja med "researcha...", "skriv..." etc). Vad vill du göra?';
                break;
            }

            case 'STATUS_CHECK': {
                if (customerSlug) {
                    const { data: customerData, error } = await supabase
                        .from('customer_status')
                        .select('*')
                        .eq('slug', customerSlug)
                        .single();

                    if (error || !customerData) {
                        responseText = `Kunde inte hitta kund med slug "${customerSlug}".`;
                    } else {
                        data.customer = customerData;
                        actions_taken.push({ action: 'query', table: 'customer_status', details: { slug: customerSlug } });
                        const status = customerData.status;
                        const errors = customerData.errors_24h || 0;
                        const warnings = customerData.warnings_24h || 0;
                        const openTasks = customerData.open_tasks || 0;

                        responseText = `${customerData.name}: Status är "${status}". ${errors} fel, ${warnings} varningar (senaste 24h). ${openTasks} öppna uppgifter.`;
                    }
                } else {
                    responseText = 'Jag förstod att du vill ha status, men kunde inte avgöra vilken kund. Prova "hur går det för Axel?"';
                }
                break;
            }

            case 'SUMMARY': {
                const { data: allCustomers, error } = await supabase
                    .from('customer_status')
                    .select('*');

                if (error) {
                    responseText = 'Kunde inte hämta kundstatus.';
                } else {
                    data.customers = allCustomers;
                    actions_taken.push({ action: 'query', table: 'customer_status', details: { count: allCustomers?.length || 0 } });
                    const errorCount = allCustomers?.filter((c: { status: string }) => c.status === 'error').length || 0;
                    const warningCount = allCustomers?.filter((c: { status: string }) => c.status === 'warning').length || 0;
                    const activeCount = allCustomers?.filter((c: { status: string }) => c.status === 'active').length || 0;

                    responseText = `Sammanfattning: ${allCustomers?.length || 0} kunder totalt. ${activeCount} aktiva, ${warningCount} med varningar, ${errorCount} med fel.`;
                }
                break;
            }

            case 'CREATE_TASK': {
                // Determine priority
                const isUrgent = message.toLowerCase().includes('urgent') || message.toLowerCase().includes('brådskande');
                const priority = isUrgent ? 'high' : 'normal';

                // Create title from message (remove trigger words)
                let title = message;
                if (title.toLowerCase().startsWith('create task:')) {
                    title = title.substring(12).trim();
                }

                // Create task with status='review' (SUGGEST mode)
                const taskInput = {
                    source_message: message,
                    conversation_id,
                    requested_by: 'internal'
                };

                const { data: createdTask, error: taskError } = await supabase
                    .from('tasks')
                    .insert({
                        title,
                        status: 'review',
                        priority,
                        customer_id: customerId,
                        input: taskInput
                    })
                    .select()
                    .single();

                if (taskError) {
                    console.error('Error creating task:', taskError);
                    responseText = 'Kunde inte skapa uppgiften. Försök igen.';
                } else {
                    data.task = createdTask;
                    actions_taken.push({ action: 'insert', table: 'tasks', details: { task_id: createdTask.id, status: 'review' } });
                    proposed_actions.push({
                        type: 'TASK_CREATED',
                        task_id: createdTask.id,
                        task: createdTask
                    });
                    suggestions.push('Vill du godkänna tasken?');

                    responseText = `Skapar uppgift: "${title}" (prioritet: ${priority}, status: review). Tasken behöver godkännas innan den körs.`;
                }
                break;
            }
        }

        // Log outbound message
        await logMessage({
            conversation_id,
            role: 'assistant',
            channel,
            direction: 'internal',
            content: responseText,
            customer_id: customerId
        });
        actions_taken.push({ action: 'insert', table: 'messages', details: { role: 'assistant', conversation_id } });

        // Log activity for traceability
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'master_brain',
            action: `chat_${intent.toLowerCase()}`,
            event_type: 'chat',
            severity: 'info',
            autonomy_level: intent === 'CREATE_TASK' ? 'SUGGEST' : 'OBSERVE',
            details: {
                conversation_id,
                intent,
                channel,
                has_proposed_actions: proposed_actions.length > 0
            }
        });
        actions_taken.push({ action: 'insert', table: 'activities', details: { event_type: 'chat', intent } });

        // Return response
        return res.json({
            response: responseText,
            conversation_id,
            intent,
            data,
            actions_taken,
            proposed_actions,
            suggestions
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
// Start server
// ============================================================================
app.listen(PORT, () => {
    console.log(`🚀 Skyland Command Center API running on port ${PORT}`);
});
