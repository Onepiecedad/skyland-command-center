import { z } from 'zod';

export const activitiesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    customer_id: z.string().uuid().optional(),
    agent: z.string().optional(),
    event_type: z.string().optional(),
    severity: z.enum(['info', 'warn', 'error']).optional(),
    since: z.string().datetime().optional()
});

export const activitySchema = z.object({
    customer_id: z.union([z.string().uuid(), z.literal(null)]).optional(),
    agent: z.string().min(1),
    action: z.string().min(1),
    event_type: z.string().min(1),
    severity: z.enum(['info', 'warn', 'error']).default('info'),
    autonomy_level: z.enum(['OBSERVE', 'SUGGEST', 'ACT', 'SILENT']).default('OBSERVE'),
    details: z.record(z.string(), z.unknown()).default({}),
});
