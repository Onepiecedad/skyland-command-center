import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

// GET /health - checks if Supabase is reachable
router.get('/health', async (_req: Request, res: Response) => {
    const time = new Date().toISOString();

    try {
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

// GET /status - system summary with counts
router.get('/status', async (_req: Request, res: Response) => {
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

export default router;
