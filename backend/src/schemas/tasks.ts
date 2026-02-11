import { z } from 'zod';

export const tasksQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    customer_id: z.string().uuid().optional(),
    assigned_agent: z.string().optional(),
    status: z.enum(['created', 'assigned', 'in_progress', 'review', 'completed', 'failed']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
});

export const createTaskSchema = z.object({
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

export const updateTaskSchema = z.object({
    status: z.enum(['created', 'assigned', 'in_progress', 'review', 'completed', 'failed']).optional(),
    assigned_agent: z.string().optional(),
    output: z.record(z.string(), z.unknown()).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    description: z.string().optional()
});

export const approveTaskSchema = z.object({
    approved_by: z.string().min(1)
});

export const progressDataSchema = z.object({
    percent: z.number().min(0).max(100).optional(),
    current_step: z.string().optional(),
    steps: z.array(z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(['pending', 'running', 'completed', 'failed'])
    })).optional()
});

export const progressSchema = z.object({
    progress: progressDataSchema
});
