import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// In-memory Event Hub
// ============================================================================
interface StreamEvent {
    id: string;
    type: string;
    data: Record<string, unknown>;
    source?: string;
    timestamp: string;
}

const eventHub = new EventEmitter();
eventHub.setMaxListeners(100); // Allow many concurrent SSE connections

let eventCounter = 0;

function createEvent(type: string, data: Record<string, unknown>, source?: string): StreamEvent {
    eventCounter++;
    return {
        id: `evt_${Date.now()}_${eventCounter}`,
        type,
        data,
        source: source || 'system',
        timestamp: new Date().toISOString(),
    };
}

// Public helper for other modules to emit events
export function emitSystemEvent(type: string, data: Record<string, unknown>, source?: string): void {
    const event = createEvent(type, data, source);
    eventHub.emit('event', event);
}

// ============================================================================
// GET /stream — SSE connection
// ============================================================================
router.get('/stream', (req: Request, res: Response) => {
    const typesParam = req.query.types as string | undefined;
    const agentId = req.query.agentId as string | undefined;
    const customerId = req.query.customerId as string | undefined;

    const allowedTypes = typesParam
        ? typesParam.split(',').map((t: string) => t.trim()).filter(Boolean)
        : null;

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    // Event listener
    const onEvent = (event: StreamEvent) => {
        // Filter by type
        if (allowedTypes && !allowedTypes.includes(event.type)) return;

        // Filter by agent
        if (agentId && event.data.agent !== agentId) return;

        // Filter by customer
        if (customerId && event.data.customer_id !== customerId) return;

        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventHub.on('event', onEvent);

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
        res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, 30000);

    // Cleanup on close
    req.on('close', () => {
        eventHub.off('event', onEvent);
        clearInterval(heartbeat);
    });
});

// ============================================================================
// POST /emit — Push custom event
// ============================================================================
const emitSchema = z.object({
    type: z.string().min(1),
    data: z.record(z.string(), z.unknown()).default({}),
    source: z.string().optional(),
});

router.post('/emit', (req: Request, res: Response) => {
    const parsed = emitSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: 'Validation failed',
            details: parsed.error.issues.map((e: z.ZodIssue) => ({
                field: e.path.join('.'),
                message: e.message,
            })),
        });
    }

    const event = createEvent(parsed.data.type, parsed.data.data, parsed.data.source);
    eventHub.emit('event', event);

    return res.status(201).json({ event });
});

// ============================================================================
// GET /recent — Fetch recent events (fallback for non-SSE clients)
// ============================================================================
const recentSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    types: z.string().optional(),
    since: z.string().optional(),
});

router.get('/recent', async (req: Request, res: Response) => {
    try {
        const parsed = recentSchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
        }

        const { limit, types, since } = parsed.data;

        let query = supabase
            .from('activities')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (types) {
            const typeList = types.split(',').map((t: string) => t.trim()).filter(Boolean);
            if (typeList.length > 0) {
                query = query.in('event_type', typeList);
            }
        }

        if (since) {
            query = query.gte('created_at', since);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching recent events:', error);
            return res.status(500).json({ error: error.message });
        }

        // Map activities to event format
        const events = (data || []).map((a: Record<string, unknown>) => ({
            id: a.id,
            type: a.event_type,
            data: {
                agent: a.agent,
                action: a.action,
                severity: a.severity,
                customer_id: a.customer_id,
                details: a.details,
            },
            source: a.agent,
            timestamp: a.created_at,
        }));

        return res.json({ events, count: events.length });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
