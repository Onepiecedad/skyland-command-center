import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { execSync } from 'child_process';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// Types
// ============================================================================
interface ToolDefinition {
    name: string;
    description: string;
    category: string;
    schema: z.ZodObject<Record<string, z.ZodTypeAny>>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// ============================================================================
// Tool Registry
// ============================================================================
const toolRegistry: Map<string, ToolDefinition> = new Map();

/** Register a tool in the registry */
function registerTool(tool: ToolDefinition): void {
    toolRegistry.set(tool.name, tool);
}

// ============================================================================
// Built-in Tools
// ============================================================================

// --- Git Status ---
registerTool({
    name: 'git_status',
    description: 'Get current git status (modified, staged, untracked files)',
    category: 'git',
    schema: z.object({
        cwd: z.string().optional().describe('Working directory, defaults to project root'),
    }),
    handler: async (params) => {
        const cwd = (params.cwd as string) || process.cwd();
        try {
            const output = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 10000 });
            const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
            const files = output.trim().split('\n').filter(Boolean).map(line => ({
                status: line.substring(0, 2).trim(),
                file: line.substring(3),
            }));
            return { branch, files, file_count: files.length };
        } catch (err: unknown) {
            return { error: (err as Error).message };
        }
    },
});

// --- Git Diff ---
registerTool({
    name: 'git_diff',
    description: 'Get diff of current changes',
    category: 'git',
    schema: z.object({
        staged: z.boolean().optional().describe('Show staged changes instead of working tree'),
        file: z.string().optional().describe('Specific file to diff'),
    }),
    handler: async (params) => {
        const cwd = process.cwd();
        const staged = params.staged ? ' --cached' : '';
        const file = params.file ? ` -- ${params.file}` : '';
        try {
            const output = execSync(`git diff${staged}${file}`, { cwd, encoding: 'utf-8', timeout: 15000 });
            return { diff: output, lines: output.split('\n').length };
        } catch (err: unknown) {
            return { error: (err as Error).message };
        }
    },
});

// --- System Info ---
registerTool({
    name: 'system_info',
    description: 'Get system information (memory, uptime, node version)',
    category: 'system',
    schema: z.object({}),
    handler: async () => {
        return {
            node_version: process.version,
            platform: process.platform,
            arch: process.arch,
            uptime_seconds: Math.floor(process.uptime()),
            memory: {
                rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            },
            timestamp: new Date().toISOString(),
        };
    },
});

// --- Database Query ---
registerTool({
    name: 'db_count',
    description: 'Get row count from a Supabase table',
    category: 'database',
    schema: z.object({
        table: z.enum(['customers', 'activities', 'tasks', 'messages', 'agent_configs'])
            .describe('Table to count rows from'),
    }),
    handler: async (params) => {
        const table = params.table as string;
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (error) return { error: error.message };
        return { table, count };
    },
});

// --- Recent Activities ---
registerTool({
    name: 'recent_activities',
    description: 'Fetch recent activity entries',
    category: 'database',
    schema: z.object({
        limit: z.number().min(1).max(100).optional().describe('Max number of entries (default 20)'),
        severity: z.enum(['info', 'warn', 'error']).optional().describe('Filter by severity'),
    }),
    handler: async (params) => {
        const limit = (params.limit as number) || 20;
        let query = supabase
            .from('activities')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (params.severity) {
            query = query.eq('severity', params.severity);
        }

        const { data, error } = await query;
        if (error) return { error: error.message };
        return { activities: data, count: data?.length || 0 };
    },
});

// ============================================================================
// GET /api/v1/tools — List all registered tools
// ============================================================================
router.get('/', (_req: Request, res: Response) => {
    const tools = Array.from(toolRegistry.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        parameters: Object.keys(tool.schema.shape).map(key => {
            const field = tool.schema.shape[key];
            return {
                name: key,
                required: !field.isOptional(),
                description: field.description || '',
            };
        }),
    }));

    return res.json({
        tools,
        count: tools.length,
        categories: [...new Set(tools.map(t => t.category))],
    });
});

// ============================================================================
// POST /api/v1/tools/invoke — Execute a registered tool
// ============================================================================
router.post('/invoke', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
        const { tool, params, agent_id } = req.body as {
            tool?: string;
            params?: Record<string, unknown>;
            agent_id?: string;
        };

        if (!tool || typeof tool !== 'string') {
            return res.status(400).json({ error: 'Missing required field: tool (string)' });
        }

        const toolDef = toolRegistry.get(tool);
        if (!toolDef) {
            return res.status(404).json({
                error: `Tool '${tool}' not found`,
                available: Array.from(toolRegistry.keys()),
            });
        }

        // Validate params against schema
        const parsed = toolDef.schema.safeParse(params || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Invalid parameters',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        // Execute the tool
        const result = await toolDef.handler(parsed.data);
        const duration_ms = Date.now() - startTime;

        // Log the invocation as an activity
        try {
            await supabase.from('activities').insert({
                agent: agent_id || 'system',
                action: `tool_invoke:${tool}`,
                event_type: 'tool_invocation',
                severity: 'info',
                details: {
                    tool,
                    params: parsed.data,
                    duration_ms,
                    agent_id: agent_id || 'system',
                },
            });
        } catch (logErr) {
            console.error('Failed to log tool invocation:', logErr);
        }

        return res.json({
            tool,
            status: 'success',
            result,
            duration_ms,
            agent_id: agent_id || 'system',
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        const duration_ms = Date.now() - startTime;
        console.error('Error invoking tool:', err);
        return res.status(500).json({
            error: 'Tool invocation failed',
            duration_ms,
        });
    }
});

export default router;
