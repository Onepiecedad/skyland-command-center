import { z } from 'zod';

export const costsQuerySchema = z.object({
    range: z.enum(['7d', '30d']).default('30d')
});

export const costEntrySchema = z.object({
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
