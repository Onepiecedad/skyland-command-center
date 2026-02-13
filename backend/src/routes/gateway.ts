/**
 * Gateway Router — Proxies OpenClaw gateway API calls
 *
 * Replaces the fragile direct-WebSocket approach used by the Fleet view.
 * All calls go through the backend using CLAWDBOT_GATEWAY_URL + token.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config.js';

const router = Router();

const GATEWAY_TIMEOUT_MS = 15_000;

/** Proxy a POST request to the OpenClaw gateway */
async function gatewayFetch(
    path: string,
    body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const baseUrl = config.CLAWDBOT_GATEWAY_URL;
    const token = config.CLAWDBOT_GATEWAY_TOKEN;

    if (!token) {
        return { ok: false, status: 503, data: { error: 'CLAWDBOT_GATEWAY_TOKEN not configured' } };
    }

    const url = `${baseUrl}${path}`;
    console.log(`[gateway-proxy] → ${url}`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const data = (await response.json()) as Record<string, unknown>;
        console.log(`[gateway-proxy] ← ${response.status}`, JSON.stringify(data).substring(0, 200));
        return { ok: response.ok, status: response.status, data };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[gateway-proxy] Error: ${message}`);
        return {
            ok: false,
            status: 502,
            data: { error: `Gateway unreachable: ${message}` },
        };
    }
}

// ============================================================================
// Helper — Extract result from gateway /tools/invoke response
// The gateway wraps results as: { result: { content: [{ type: "text", text: "..." }] } }
// ============================================================================
function extractToolResult(data: Record<string, unknown>): Record<string, unknown> {
    const result = data.result as Record<string, unknown> | undefined;
    if (!result) return {};

    // Try content[0].text (standard MCP tool response format)
    const content = result.content as Array<{ type: string; text: string }> | undefined;
    if (content && content.length > 0 && content[0].text) {
        try {
            return JSON.parse(content[0].text) as Record<string, unknown>;
        } catch {
            console.warn('[gateway-proxy] Failed to parse content[0].text');
        }
    }

    // Fallback: result might directly contain the data
    return result;
}

// ============================================================================
// GET /api/v1/gateway/sessions
// Returns all agent sessions from the OpenClaw gateway
// ============================================================================
router.get('/sessions', async (_req: Request, res: Response) => {
    const result = await gatewayFetch('/tools/invoke', {
        tool: 'sessions_list',
        action: 'list',
        args: { agentId: 'main' },
        sessionKey: 'main',
    });

    if (!result.ok) {
        return res.status(result.status).json({
            error: 'Failed to fetch sessions from gateway',
            details: result.data.error,
        });
    }

    const parsed = extractToolResult(result.data);
    const sessions = parsed.sessions || [];

    return res.json({ sessions });
});

// ============================================================================
// GET /api/v1/gateway/chat-history?sessionKey=...&limit=20
// Returns chat history for a specific session
// ============================================================================
router.get('/chat-history', async (req: Request, res: Response) => {
    const sessionKey = req.query.sessionKey as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!sessionKey) {
        return res.status(400).json({ error: 'sessionKey query parameter is required' });
    }

    const result = await gatewayFetch('/tools/invoke', {
        tool: 'chat_history',
        action: 'get',
        args: { sessionKey, limit },
        sessionKey: 'main',
    });

    if (!result.ok) {
        return res.status(result.status).json({
            error: 'Failed to fetch chat history from gateway',
            details: result.data.error,
        });
    }

    const parsed = extractToolResult(result.data);
    const messages = parsed.messages || [];

    return res.json({ messages });
});

// ============================================================================
// GET /api/v1/gateway/status
// Quick check if gateway is reachable
// ============================================================================
router.get('/status', async (_req: Request, res: Response) => {
    const token = config.CLAWDBOT_GATEWAY_TOKEN;
    if (!token) {
        return res.json({ connected: false, reason: 'Token not configured' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${config.CLAWDBOT_GATEWAY_URL}/health`, {
            signal: controller.signal,
            headers: { 'Authorization': `Bearer ${token}` },
        });

        clearTimeout(timeout);

        return res.json({
            connected: response.ok,
            gatewayStatus: response.status,
        });
    } catch {
        return res.json({ connected: false, reason: 'Gateway unreachable' });
    }
});

export default router;
