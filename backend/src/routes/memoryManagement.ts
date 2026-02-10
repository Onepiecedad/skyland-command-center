import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// Default retention policy
// ============================================================================
const DEFAULT_RETENTION = {
    activities_days: 90,
    messages_days: 60,
    task_runs_days: 30,
};

const RETENTION_CONFIG_KEY = 'memory_manager';

// ============================================================================
// GET /storage — Storage overview
// ============================================================================
router.get('/storage', async (_req: Request, res: Response) => {
    try {
        const tables = [
            { name: 'activities', date_col: 'created_at' },
            { name: 'messages', date_col: 'created_at' },
            { name: 'tasks', date_col: 'created_at' },
            { name: 'task_runs', date_col: 'queued_at' },
            { name: 'costs', date_col: 'created_at' },
        ] as const;

        const storage: Record<string, {
            row_count: number;
            oldest_record?: string;
            newest_record?: string;
        }> = {};

        for (const table of tables) {
            // Row count
            const { count } = await supabase
                .from(table.name)
                .select('*', { count: 'exact', head: true });

            // Oldest record
            const { data: oldestData } = await supabase
                .from(table.name)
                .select(table.date_col)
                .order(table.date_col, { ascending: true })
                .limit(1);

            // Newest record
            const { data: newestData } = await supabase
                .from(table.name)
                .select(table.date_col)
                .order(table.date_col, { ascending: false })
                .limit(1);

            const oldest = oldestData?.[0]?.[table.date_col as keyof typeof oldestData[0]];
            const newest = newestData?.[0]?.[table.date_col as keyof typeof newestData[0]];

            storage[table.name] = {
                row_count: count ?? 0,
                oldest_record: oldest ? String(oldest) : undefined,
                newest_record: newest ? String(newest) : undefined,
            };
        }

        // Total rows
        const totalRows = Object.values(storage).reduce((sum, t) => sum + t.row_count, 0);

        return res.json({
            storage,
            total_rows: totalRows,
            generated_at: new Date().toISOString(),
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /archive — Archive (delete) old records
// ============================================================================
const archiveSchema = z.object({
    table: z.enum(['activities', 'messages', 'task_runs']),
    before_date: z.string().min(1),
    dry_run: z.boolean().default(false),
});

router.post('/archive', async (req: Request, res: Response) => {
    try {
        const parsed = archiveSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        const { table, before_date, dry_run } = parsed.data;

        const dateColumn = table === 'task_runs' ? 'queued_at' : 'created_at';

        if (dry_run) {
            // Count only
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .lt(dateColumn, before_date);

            if (error) {
                console.error('Error counting archive candidates:', error);
                return res.status(500).json({ error: error.message });
            }

            return res.json({
                dry_run: true,
                table,
                before_date,
                records_to_delete: count ?? 0,
            });
        }

        // Actual deletion
        const { data: deleted, error } = await supabase
            .from(table)
            .delete()
            .lt(dateColumn, before_date)
            .select('id');

        if (error) {
            console.error('Error archiving records:', error);
            return res.status(500).json({ error: error.message });
        }

        const deletedCount = deleted?.length ?? 0;

        // Log as activity
        await supabase.from('activities').insert({
            agent: 'system',
            action: `archived_${table}`,
            event_type: 'memory_cleanup',
            severity: 'info',
            details: {
                table,
                before_date,
                deleted_count: deletedCount,
            },
        });

        return res.json({
            dry_run: false,
            table,
            before_date,
            deleted_count: deletedCount,
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /retention — Get retention policy
// ============================================================================
router.get('/retention', async (_req: Request, res: Response) => {
    try {
        const { data } = await supabase
            .from('agent_configs')
            .select('config')
            .eq('agent_name', RETENTION_CONFIG_KEY)
            .single();

        const policy = data?.config || DEFAULT_RETENTION;

        return res.json({
            policy: {
                activities_days: policy.activities_days ?? DEFAULT_RETENTION.activities_days,
                messages_days: policy.messages_days ?? DEFAULT_RETENTION.messages_days,
                task_runs_days: policy.task_runs_days ?? DEFAULT_RETENTION.task_runs_days,
            },
            source: data ? 'configured' : 'default',
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /retention — Update retention policy
// ============================================================================
const retentionSchema = z.object({
    activities_days: z.number().int().min(1).max(365).optional(),
    messages_days: z.number().int().min(1).max(365).optional(),
    task_runs_days: z.number().int().min(1).max(365).optional(),
});

router.put('/retention', async (req: Request, res: Response) => {
    try {
        const parsed = retentionSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        // Merge with defaults
        const policy = {
            activities_days: parsed.data.activities_days ?? DEFAULT_RETENTION.activities_days,
            messages_days: parsed.data.messages_days ?? DEFAULT_RETENTION.messages_days,
            task_runs_days: parsed.data.task_runs_days ?? DEFAULT_RETENTION.task_runs_days,
        };

        // Upsert into agent_configs
        const { data: existing } = await supabase
            .from('agent_configs')
            .select('id')
            .eq('agent_name', RETENTION_CONFIG_KEY)
            .single();

        if (existing) {
            await supabase
                .from('agent_configs')
                .update({ config: policy, updated_at: new Date().toISOString() })
                .eq('agent_name', RETENTION_CONFIG_KEY);
        } else {
            await supabase.from('agent_configs').insert({
                agent_name: RETENTION_CONFIG_KEY,
                display_name: 'Memory Manager',
                description: 'Automated memory retention policy configuration',
                config: policy,
            });
        }

        return res.json({ policy, status: 'updated' });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /cleanup — Run cleanup based on retention policy
// ============================================================================
router.post('/cleanup', async (_req: Request, res: Response) => {
    try {
        // Get current retention policy
        const { data: configData } = await supabase
            .from('agent_configs')
            .select('config')
            .eq('agent_name', RETENTION_CONFIG_KEY)
            .single();

        const policy = configData?.config || DEFAULT_RETENTION;

        const cleanupResults: Record<string, number> = {};

        // Cleanup activities
        const activitiesCutoff = new Date(Date.now() - (policy.activities_days ?? 90) * 24 * 60 * 60 * 1000).toISOString();
        const { data: deletedActivities } = await supabase
            .from('activities')
            .delete()
            .lt('created_at', activitiesCutoff)
            .select('id');
        cleanupResults.activities = deletedActivities?.length ?? 0;

        // Cleanup messages
        const messagesCutoff = new Date(Date.now() - (policy.messages_days ?? 60) * 24 * 60 * 60 * 1000).toISOString();
        const { data: deletedMessages } = await supabase
            .from('messages')
            .delete()
            .lt('created_at', messagesCutoff)
            .select('id');
        cleanupResults.messages = deletedMessages?.length ?? 0;

        // Cleanup task_runs
        const runsCutoff = new Date(Date.now() - (policy.task_runs_days ?? 30) * 24 * 60 * 60 * 1000).toISOString();
        const { data: deletedRuns } = await supabase
            .from('task_runs')
            .delete()
            .lt('queued_at', runsCutoff)
            .select('id');
        cleanupResults.task_runs = deletedRuns?.length ?? 0;

        const totalDeleted = Object.values(cleanupResults).reduce((sum, c) => sum + c, 0);

        // Log cleanup as activity
        await supabase.from('activities').insert({
            agent: 'system',
            action: 'memory_cleanup',
            event_type: 'memory_cleanup',
            severity: 'info',
            details: {
                policy,
                results: cleanupResults,
                total_deleted: totalDeleted,
            },
        });

        return res.json({
            status: 'completed',
            policy,
            results: cleanupResults,
            total_deleted: totalDeleted,
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
