import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// Relevance scoring helper
// ============================================================================
interface SearchResult {
    source_type: 'activity' | 'message' | 'task';
    source_id: string;
    snippet: string;
    relevance_score: number;
    created_at: string;
    metadata: Record<string, unknown>;
}

function calculateRelevance(
    text: string,
    keywords: string[],
    createdAt: string,
    severityWeight: number
): number {
    const lowerText = text.toLowerCase();
    let score = 0;

    // Keyword frequency scoring
    for (const kw of keywords) {
        const regex = new RegExp(kw.toLowerCase(), 'g');
        const matches = lowerText.match(regex);
        if (matches) {
            score += matches.length * 10;
        }
    }

    // Recency boost: newer records score higher
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 1) score += 20;
    else if (ageDays < 7) score += 10;
    else if (ageDays < 30) score += 5;

    // Severity weight
    score += severityWeight;

    return Math.round(score * 100) / 100;
}

function getSeverityWeight(severity: string): number {
    switch (severity) {
        case 'error': return 15;
        case 'warn': return 8;
        default: return 0;
    }
}

function truncateSnippet(text: string, maxLength = 200): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// ============================================================================
// POST /search — Search system memory
// ============================================================================
const searchSchema = z.object({
    query: z.string().min(1).max(500),
    scope: z.enum(['all', 'activities', 'messages', 'tasks']).default('all'),
    limit: z.number().int().min(1).max(100).default(20),
    since: z.string().optional(),
});

router.post('/search', async (req: Request, res: Response) => {
    try {
        const parsed = searchSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        const { query, scope, limit, since } = parsed.data;
        const keywords = query.split(/\s+/).filter((k: string) => k.length > 1);
        const results: SearchResult[] = [];

        if (keywords.length === 0) {
            return res.json({ results: [], count: 0, query });
        }

        // Build ilike pattern
        const likePattern = `%${keywords.join('%')}%`;

        // Search activities
        if (scope === 'all' || scope === 'activities') {
            let activityQuery = supabase
                .from('activities')
                .select('*')
                .or(`action.ilike.${likePattern},agent.ilike.${likePattern}`)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (since) activityQuery = activityQuery.gte('created_at', since);

            const { data: activities } = await activityQuery;

            for (const a of (activities || [])) {
                const text = `${a.action} ${a.agent} ${JSON.stringify(a.details || {})}`;
                const score = calculateRelevance(text, keywords, a.created_at, getSeverityWeight(a.severity));

                if (score > 0) {
                    results.push({
                        source_type: 'activity',
                        source_id: a.id,
                        snippet: truncateSnippet(`[${a.agent}] ${a.action}`),
                        relevance_score: score,
                        created_at: a.created_at,
                        metadata: {
                            agent: a.agent,
                            severity: a.severity,
                            event_type: a.event_type,
                            customer_id: a.customer_id,
                        },
                    });
                }
            }
        }

        // Search messages
        if (scope === 'all' || scope === 'messages') {
            let messageQuery = supabase
                .from('messages')
                .select('*')
                .ilike('content', likePattern)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (since) messageQuery = messageQuery.gte('created_at', since);

            const { data: messages } = await messageQuery;

            for (const m of (messages || [])) {
                const score = calculateRelevance(m.content, keywords, m.created_at, 0);

                if (score > 0) {
                    results.push({
                        source_type: 'message',
                        source_id: m.id,
                        snippet: truncateSnippet(m.content),
                        relevance_score: score,
                        created_at: m.created_at,
                        metadata: {
                            role: m.role,
                            channel: m.channel,
                            direction: m.direction,
                            conversation_id: m.conversation_id,
                        },
                    });
                }
            }
        }

        // Search tasks
        if (scope === 'all' || scope === 'tasks') {
            let taskQuery = supabase
                .from('tasks')
                .select('*')
                .or(`title.ilike.${likePattern},description.ilike.${likePattern}`)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (since) taskQuery = taskQuery.gte('created_at', since);

            const { data: tasks } = await taskQuery;

            for (const t of (tasks || [])) {
                const text = `${t.title} ${t.description || ''}`;
                const score = calculateRelevance(text, keywords, t.created_at, 0);

                if (score > 0) {
                    results.push({
                        source_type: 'task',
                        source_id: t.id,
                        snippet: truncateSnippet(t.title + (t.description ? ` — ${t.description}` : '')),
                        relevance_score: score,
                        created_at: t.created_at,
                        metadata: {
                            status: t.status,
                            priority: t.priority,
                            assigned_agent: t.assigned_agent,
                            customer_id: t.customer_id,
                        },
                    });
                }
            }
        }

        // Sort by relevance score descending, then by recency
        results.sort((a, b) => {
            if (b.relevance_score !== a.relevance_score) {
                return b.relevance_score - a.relevance_score;
            }
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        const trimmed = results.slice(0, limit);

        return res.json({
            results: trimmed,
            count: trimmed.length,
            total_matches: results.length,
            query,
            scope,
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /timeline — Chronological memory view
// ============================================================================
const timelineSchema = z.object({
    agentId: z.string().optional(),
    customerId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    since: z.string().optional(),
    until: z.string().optional(),
});

router.get('/timeline', async (req: Request, res: Response) => {
    try {
        const parsed = timelineSchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        const { agentId, customerId, limit, since, until } = parsed.data;
        const halfLimit = Math.ceil(limit / 2);

        // Fetch activities
        let activityQuery = supabase
            .from('activities')
            .select('id, agent, action, event_type, severity, customer_id, created_at')
            .order('created_at', { ascending: false })
            .limit(halfLimit);

        if (agentId) activityQuery = activityQuery.eq('agent', agentId);
        if (customerId) activityQuery = activityQuery.eq('customer_id', customerId);
        if (since) activityQuery = activityQuery.gte('created_at', since);
        if (until) activityQuery = activityQuery.lte('created_at', until);

        // Fetch messages
        let messageQuery = supabase
            .from('messages')
            .select('id, role, channel, direction, content, customer_id, created_at')
            .order('created_at', { ascending: false })
            .limit(halfLimit);

        if (customerId) messageQuery = messageQuery.eq('customer_id', customerId);
        if (since) messageQuery = messageQuery.gte('created_at', since);
        if (until) messageQuery = messageQuery.lte('created_at', until);

        const [actRes, msgRes] = await Promise.all([activityQuery, messageQuery]);

        // Build unified timeline
        interface TimelineEntry {
            type: 'activity' | 'message';
            id: string;
            summary: string;
            created_at: string;
            metadata: Record<string, unknown>;
        }

        const timeline: TimelineEntry[] = [];

        for (const a of (actRes.data || [])) {
            timeline.push({
                type: 'activity',
                id: a.id,
                summary: `[${a.agent}] ${a.action}`,
                created_at: a.created_at,
                metadata: { event_type: a.event_type, severity: a.severity, customer_id: a.customer_id },
            });
        }

        for (const m of (msgRes.data || [])) {
            timeline.push({
                type: 'message',
                id: m.id,
                summary: truncateSnippet(m.content, 120),
                created_at: m.created_at,
                metadata: { role: m.role, channel: m.channel, direction: m.direction, customer_id: m.customer_id },
            });
        }

        // Sort by created_at descending
        timeline.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return res.json({
            timeline: timeline.slice(0, limit),
            count: timeline.length,
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /stats — Memory statistics
// ============================================================================
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const tables = ['activities', 'messages', 'tasks', 'task_runs', 'costs'] as const;
        const stats: Record<string, { count: number; oldest?: string; newest?: string }> = {};

        for (const table of tables) {
            // Count
            const { count } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });

            // Oldest
            const { data: oldest } = await supabase
                .from(table)
                .select('created_at')
                .order('created_at', { ascending: true })
                .limit(1);

            // Newest
            const { data: newest } = await supabase
                .from(table)
                .select('created_at')
                .order('created_at', { ascending: false })
                .limit(1);

            stats[table] = {
                count: count ?? 0,
                oldest: (oldest?.[0] as Record<string, unknown> | undefined)?.created_at as string | undefined,
                newest: (newest?.[0] as Record<string, unknown> | undefined)?.created_at as string | undefined,
            };
        }

        // Top agents by activity count
        const { data: agentData } = await supabase
            .from('activities')
            .select('agent')
            .limit(500);

        const agentCounts = new Map<string, number>();
        for (const a of (agentData || [])) {
            agentCounts.set(a.agent, (agentCounts.get(a.agent) || 0) + 1);
        }

        const topAgents = Array.from(agentCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([agent, count]) => ({ agent, count }));

        // Top event types
        const { data: eventData } = await supabase
            .from('activities')
            .select('event_type')
            .limit(500);

        const eventCounts = new Map<string, number>();
        for (const e of (eventData || [])) {
            eventCounts.set(e.event_type, (eventCounts.get(e.event_type) || 0) + 1);
        }

        const topEventTypes = Array.from(eventCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event_type, count]) => ({ event_type, count }));

        return res.json({
            tables: stats,
            top_agents: topAgents,
            top_event_types: topEventTypes,
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
