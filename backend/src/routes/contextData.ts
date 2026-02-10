import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { scanSkills, SKILLS_DIR } from './skillRegistry';

const router = Router();

// ============================================================================
// GET /api/v1/context/customer/:slug — Customer-centric context
// ⚠️ Must be registered BEFORE /:agentId to avoid "customer" being caught as agentId
// Returns: customer info + status, recent activities, open tasks
// ============================================================================
router.get('/customer/:slug', async (req: Request, res: Response) => {
    try {
        const slug = req.params.slug as string;

        // Fetch customer with derived status
        const { data: customer, error: custErr } = await supabase
            .from('customer_status')
            .select('*')
            .eq('slug', slug)
            .single();

        if (custErr || !customer) {
            return res.status(404).json({ error: `Customer '${slug}' not found` });
        }

        // Fetch recent activities for this customer
        const { data: activities, error: actErr } = await supabase
            .from('activities')
            .select('*')
            .eq('customer_id', customer.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (actErr) console.error('Context: customer activity error:', actErr);

        // Fetch open tasks for this customer
        const { data: tasks, error: taskErr } = await supabase
            .from('tasks')
            .select('*')
            .eq('customer_id', customer.id)
            .in('status', ['created', 'assigned', 'in_progress', 'review'])
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false });

        if (taskErr) console.error('Context: customer task error:', taskErr);

        // Fetch agents that have worked on this customer
        const { data: agentActivities } = await supabase
            .from('activities')
            .select('agent')
            .eq('customer_id', customer.id)
            .order('created_at', { ascending: false })
            .limit(100);

        const uniqueAgents = [...new Set((agentActivities || []).map((a: { agent: string }) => a.agent))];

        return res.json({
            customer: {
                id: customer.id,
                name: customer.name,
                slug: customer.slug,
                status: customer.status,
                errors_24h: customer.errors_24h,
                warnings_24h: customer.warnings_24h,
                open_tasks: customer.open_tasks,
                failed_tasks_24h: customer.failed_tasks_24h,
                last_activity: customer.last_activity,
            },
            context: {
                activities: activities || [],
                tasks: tasks || [],
                related_agents: uniqueAgents,
            },
        });
    } catch (err) {
        console.error('Error building customer context:', err);
        return res.status(500).json({ error: 'Failed to build customer context' });
    }
});

// ============================================================================
// GET /api/v1/context/:agentId — Agent's full context
// Returns: recent activities, assigned tasks, available skills, system status
// ============================================================================
router.get('/:agentId', async (req: Request, res: Response) => {
    try {
        const agentId = req.params.agentId as string;

        // Fetch recent activities for this agent (last 50)
        const { data: activities, error: actErr } = await supabase
            .from('activities')
            .select('*')
            .eq('agent', agentId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (actErr) console.error('Context: activity fetch error:', actErr);

        // Fetch open tasks assigned to this agent
        const { data: tasks, error: taskErr } = await supabase
            .from('tasks')
            .select('*')
            .eq('assigned_agent', agentId)
            .in('status', ['created', 'assigned', 'in_progress', 'review'])
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false });

        if (taskErr) console.error('Context: task fetch error:', taskErr);

        // Fetch active skills
        const allSkills = scanSkills(SKILLS_DIR);
        const activeSkills = allSkills.filter(s => s.enabled);

        // System status summary
        const { count: totalTasks } = await supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true });

        const { count: pendingApprovals } = await supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'review');

        const { count: errorCount } = await supabase
            .from('activities')
            .select('*', { count: 'exact', head: true })
            .eq('severity', 'error')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        return res.json({
            agent_id: agentId,
            context: {
                activities: activities || [],
                tasks: tasks || [],
                skills: {
                    active: activeSkills.map(s => ({
                        name: s.skill_name,
                        description: s.description,
                        has_scripts: s.has_scripts,
                        tags: s.tags,
                    })),
                    total: allSkills.length,
                    active_count: activeSkills.length,
                },
                system_status: {
                    total_tasks: totalTasks || 0,
                    pending_approvals: pendingApprovals || 0,
                    errors_24h: errorCount || 0,
                    timestamp: new Date().toISOString(),
                },
            },
        });
    } catch (err) {
        console.error('Error building agent context:', err);
        return res.status(500).json({ error: 'Failed to build agent context' });
    }
});

export default router;
