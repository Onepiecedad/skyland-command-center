import { z } from 'zod';

export const dispatchSchema = z.object({
    worker_id: z.string().default('backend-dispatcher-v0')
});

export const n8nCallbackSchema = z.object({
    task_id: z.string().uuid(),
    run_id: z.string().uuid(),
    success: z.boolean(),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional()
});

// Output schema for claw:research (Ticket 20 - best effort validation)
export const clawResearchOutputSchema = z.object({
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

export const clawCallbackSchema = z.object({
    task_id: z.string().uuid(),
    run_id: z.string().uuid(),
    success: z.boolean(),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional()
});
