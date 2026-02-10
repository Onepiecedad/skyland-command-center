import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// In-memory recovery rules store
// ============================================================================
interface RecoveryRule {
    id: string;
    pattern: { agent?: string; action?: string; error_contains?: string };
    recovery_action: 'retry' | 'notify' | 'disable_skill' | 'escalate';
    max_retries: number;
    cooldown_minutes: number;
    enabled: boolean;
    created_at: string;
    executions: number;
    last_executed?: string;
}

const recoveryRules: RecoveryRule[] = [];
let ruleCounter = 0;

// ============================================================================
// Error classification helper
// ============================================================================
type ErrorClass = 'transient' | 'config' | 'dependency' | 'unknown';

interface ClassificationResult {
    error_class: ErrorClass;
    confidence: number;
    suggested_action: string;
    description: string;
}

function classifyError(action: string, details: Record<string, unknown>): ClassificationResult {
    const detailStr = JSON.stringify(details).toLowerCase();
    const actionLower = action.toLowerCase();

    // Transient: timeouts, rate limits, network errors
    if (
        detailStr.includes('timeout') ||
        detailStr.includes('rate limit') ||
        detailStr.includes('429') ||
        detailStr.includes('503') ||
        detailStr.includes('econnrefused') ||
        detailStr.includes('econnreset')
    ) {
        return {
            error_class: 'transient',
            confidence: 0.85,
            suggested_action: 'retry',
            description: 'Transient error — likely to resolve on retry with backoff',
        };
    }

    // Config: auth failures, missing env, invalid parameters
    if (
        detailStr.includes('unauthorized') ||
        detailStr.includes('401') ||
        detailStr.includes('403') ||
        detailStr.includes('api key') ||
        detailStr.includes('invalid config') ||
        actionLower.includes('config')
    ) {
        return {
            error_class: 'config',
            confidence: 0.8,
            suggested_action: 'notify',
            description: 'Configuration error — requires manual intervention to fix credentials or settings',
        };
    }

    // Dependency: external service down, missing dependency
    if (
        detailStr.includes('service unavailable') ||
        detailStr.includes('not found') ||
        detailStr.includes('dependency') ||
        detailStr.includes('502') ||
        detailStr.includes('504')
    ) {
        return {
            error_class: 'dependency',
            confidence: 0.7,
            suggested_action: 'escalate',
            description: 'Dependency error — an external service or resource is unavailable',
        };
    }

    return {
        error_class: 'unknown',
        confidence: 0.3,
        suggested_action: 'notify',
        description: 'Unknown error type — requires manual investigation',
    };
}

// ============================================================================
// GET /errors — List detected error patterns
// ============================================================================
router.get('/errors', async (_req: Request, res: Response) => {
    try {
        // Aggregate errors from activities (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('activities')
            .select('*')
            .eq('severity', 'error')
            .gte('created_at', sevenDaysAgo)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) {
            console.error('Error fetching error patterns:', error);
            return res.status(500).json({ error: error.message });
        }

        // Group by agent + action
        const patternMap = new Map<string, {
            agent: string;
            action: string;
            count: number;
            first_seen: string;
            last_seen: string;
            sample_details: Record<string, unknown>;
            classification: ClassificationResult;
        }>();

        for (const activity of (data || [])) {
            const key = `${activity.agent}::${activity.action}`;
            const existing = patternMap.get(key);

            if (existing) {
                existing.count++;
                if (activity.created_at < existing.first_seen) {
                    existing.first_seen = activity.created_at;
                }
                if (activity.created_at > existing.last_seen) {
                    existing.last_seen = activity.created_at;
                }
            } else {
                patternMap.set(key, {
                    agent: activity.agent,
                    action: activity.action,
                    count: 1,
                    first_seen: activity.created_at,
                    last_seen: activity.created_at,
                    sample_details: activity.details || {},
                    classification: classifyError(activity.action, activity.details || {}),
                });
            }
        }

        const patterns = Array.from(patternMap.values())
            .sort((a, b) => b.count - a.count);

        return res.json({
            patterns,
            total_errors: (data || []).length,
            period: '7d',
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /analyze — Analyze a specific error
// ============================================================================
const analyzeSchema = z.object({
    activity_id: z.string().uuid().optional(),
    agent: z.string().optional(),
    action: z.string().optional(),
    since: z.string().optional(),
}).refine(
    (d) => d.activity_id || (d.agent && d.action),
    { message: 'Provide either activity_id or both agent and action' }
);

router.post('/analyze', async (req: Request, res: Response) => {
    try {
        const parsed = analyzeSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        const { activity_id, agent, action, since } = parsed.data;

        if (activity_id) {
            // Analyze single activity
            const { data: activity, error } = await supabase
                .from('activities')
                .select('*')
                .eq('id', activity_id)
                .single();

            if (error || !activity) {
                return res.status(404).json({ error: 'Activity not found' });
            }

            const classification = classifyError(activity.action, activity.details || {});

            return res.json({
                activity_id: activity.id,
                agent: activity.agent,
                action: activity.action,
                classification,
                details: activity.details,
                created_at: activity.created_at,
            });
        }

        // Analyze pattern by agent + action
        let query = supabase
            .from('activities')
            .select('*')
            .eq('severity', 'error')
            .order('created_at', { ascending: false })
            .limit(50);

        if (agent) query = query.eq('agent', agent);
        if (action) query = query.eq('action', action);
        if (since) query = query.gte('created_at', since);

        const { data, error } = await query;

        if (error) {
            console.error('Error analyzing errors:', error);
            return res.status(500).json({ error: error.message });
        }

        const activities = data || [];
        const classification = activities.length > 0
            ? classifyError(activities[0].action, activities[0].details || {})
            : { error_class: 'unknown' as ErrorClass, confidence: 0, suggested_action: 'notify', description: 'No errors found' };

        return res.json({
            agent,
            action,
            occurrence_count: activities.length,
            classification,
            recent_errors: activities.slice(0, 5).map((a: Record<string, unknown>) => ({
                id: a.id,
                details: a.details,
                created_at: a.created_at,
            })),
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /retry — Retry a failed task run
// ============================================================================
const retrySchema = z.object({
    task_id: z.string().uuid().optional(),
    run_id: z.string().uuid().optional(),
}).refine(
    (d) => d.task_id || d.run_id,
    { message: 'Provide either task_id or run_id' }
);

router.post('/retry', async (req: Request, res: Response) => {
    try {
        const parsed = retrySchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        const { task_id, run_id } = parsed.data;

        let targetTaskId = task_id;

        // If run_id provided, find its task_id
        if (run_id && !targetTaskId) {
            const { data: run, error: runError } = await supabase
                .from('task_runs')
                .select('task_id')
                .eq('id', run_id)
                .single();

            if (runError || !run) {
                return res.status(404).json({ error: 'Run not found' });
            }

            targetTaskId = run.task_id;
        }

        // Get the task
        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', targetTaskId)
            .single();

        if (taskError || !task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Reset task status to created for re-dispatch
        const { data: updated, error: updateError } = await supabase
            .from('tasks')
            .update({ status: 'created', output: {} })
            .eq('id', targetTaskId)
            .select()
            .single();

        if (updateError) {
            console.error('Error retrying task:', updateError);
            return res.status(500).json({ error: updateError.message });
        }

        // Log the retry as activity
        await supabase.from('activities').insert({
            agent: 'error-recovery',
            action: 'task_retry',
            event_type: 'recovery',
            severity: 'info',
            customer_id: task.customer_id,
            details: { task_id: targetTaskId, original_status: task.status },
        });

        return res.json({
            status: 'retried',
            task: updated,
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /rules — List recovery rules
// ============================================================================
router.get('/rules', (_req: Request, res: Response) => {
    return res.json({
        rules: recoveryRules,
        count: recoveryRules.length,
    });
});

// ============================================================================
// POST /rules — Create a recovery rule
// ============================================================================
const createRuleSchema = z.object({
    pattern: z.object({
        agent: z.string().optional(),
        action: z.string().optional(),
        error_contains: z.string().optional(),
    }),
    recovery_action: z.enum(['retry', 'notify', 'disable_skill', 'escalate']),
    max_retries: z.number().int().min(1).max(10).default(3),
    cooldown_minutes: z.number().int().min(1).max(1440).default(15),
});

router.post('/rules', (req: Request, res: Response) => {
    const parsed = createRuleSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: 'Validation failed',
            details: parsed.error.issues.map((e: z.ZodIssue) => ({
                field: e.path.join('.'),
                message: e.message,
            })),
        });
    }

    ruleCounter++;
    const rule: RecoveryRule = {
        id: `rule_${ruleCounter}`,
        pattern: parsed.data.pattern,
        recovery_action: parsed.data.recovery_action,
        max_retries: parsed.data.max_retries,
        cooldown_minutes: parsed.data.cooldown_minutes,
        enabled: true,
        created_at: new Date().toISOString(),
        executions: 0,
    };

    recoveryRules.push(rule);

    return res.status(201).json({ rule });
});

export default router;
