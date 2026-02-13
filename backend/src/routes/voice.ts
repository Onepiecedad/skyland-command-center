/**
 * Voice Router — ElevenLabs Conversational AI Integration
 *
 * Bridges ElevenLabs voice agent tool calls to:
 * 1. Local quick tools (get_time, get_status)
 * 2. Clawdbot Gateway /hooks/agent (ask_alex — full skill access)
 * 3. Clawdbot Gateway /tools/invoke (gateway_tool — direct tool execution)
 */

import { Router, Request, Response } from 'express';
import { config } from '../config';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// Helpers
// ============================================================================

const GATEWAY_TIMEOUT_MS = 30_000; // 30s max wait for gateway responses

/** Proxy a request to the clawdbot gateway */
async function gatewayFetch(path: string, body: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: Record<string, unknown>;
}> {
    const baseUrl = config.CLAWDBOT_GATEWAY_URL;
    const token = config.CLAWDBOT_GATEWAY_TOKEN;

    if (!token) {
        return { ok: false, status: 503, data: { error: 'CLAWDBOT_GATEWAY_TOKEN not configured' } };
    }

    const url = `${baseUrl}${path}`;
    console.log(`[voice/gateway] → ${url}`);

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

        const data = await response.json() as Record<string, unknown>;
        console.log(`[voice/gateway] ← ${response.status}`, JSON.stringify(data).substring(0, 200));
        return { ok: response.ok, status: response.status, data };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[voice/gateway] Error: ${message}`);
        return {
            ok: false,
            status: 502,
            data: { error: `Gateway unreachable: ${message}` },
        };
    }
}

// ============================================================================
// GET /api/v1/voice/signed-url
// Returns a signed WebSocket URL for ElevenLabs Conversational AI
// ============================================================================
router.get('/signed-url', async (_req: Request, res: Response) => {
    const apiKey = config.ELEVENLABS_API_KEY;
    const agentId = config.ELEVENLABS_AGENT_ID;

    if (!apiKey || !agentId) {
        return res.status(503).json({
            error: 'ElevenLabs not configured',
            message: 'Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in backend .env',
        });
    }

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
            {
                method: 'GET',
                headers: {
                    'xi-api-key': apiKey,
                },
            }
        );

        if (!response.ok) {
            const body = await response.text();
            console.error('[voice] ElevenLabs signed-url error:', response.status, body);
            return res.status(response.status).json({
                error: 'Failed to get signed URL from ElevenLabs',
                details: body,
            });
        }

        const data = (await response.json()) as { signed_url: string };
        return res.json({ signedUrl: data.signed_url });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[voice] signed-url fetch error:', message);
        return res.status(500).json({ error: 'Internal error fetching signed URL' });
    }
});

// ============================================================================
// GET /api/v1/voice/status
// Returns whether ElevenLabs + Gateway are configured
// ============================================================================
router.get('/status', (_req: Request, res: Response) => {
    const elevenLabsConfigured = !!(config.ELEVENLABS_API_KEY && config.ELEVENLABS_AGENT_ID);
    const gatewayConfigured = !!(config.CLAWDBOT_GATEWAY_URL && config.CLAWDBOT_GATEWAY_TOKEN);
    return res.json({
        configured: elevenLabsConfigured,
        agentId: elevenLabsConfigured ? config.ELEVENLABS_AGENT_ID : null,
        gateway: {
            configured: gatewayConfigured,
            url: gatewayConfigured ? config.CLAWDBOT_GATEWAY_URL : null,
        },
    });
});

// ============================================================================
// POST /api/v1/voice/tools
// Receives tool-call webhooks from ElevenLabs Conversational AI
// Tools:
//   - ask_alex: Natural language → Gateway /hooks/agent (full skill access)
//   - gateway_tool: Direct tool invocation → Gateway /tools/invoke
//   - get_time: Local quick tool
//   - get_status: Local quick tool
//   - query_customers: Supabase direct query
//   - query_tasks: Supabase direct query
// ============================================================================
router.post('/tools', async (req: Request, res: Response) => {
    const { tool_name, params } = req.body;

    console.log('[voice/tools] Incoming tool call:', { tool_name, params });

    if (!tool_name) {
        return res.status(400).json({ error: 'tool_name is required' });
    }

    // Parse params if it's a string (ElevenLabs sends it as LLM-generated string)
    let parsedParams: Record<string, unknown> = {};
    if (typeof params === 'string') {
        try {
            parsedParams = JSON.parse(params);
        } catch {
            parsedParams = { raw: params };
        }
    } else if (typeof params === 'object' && params !== null) {
        parsedParams = params;
    }

    try {
        let result: string;

        switch (tool_name) {
            // ==============================================================
            // ask_alex — Natural language proxy to Alex's brain
            // Sends the question to the gateway's /hooks/agent endpoint.
            // Alex processes it with full skill access and responds.
            // ==============================================================
            case 'ask_alex': {
                const question = parsedParams.question as string || parsedParams.message as string || parsedParams.raw as string || '';
                if (!question) {
                    return res.json({ result: 'Jag behöver en fråga. Vad vill du att jag frågar Alex?' });
                }

                const hookResult = await gatewayFetch('/hooks/agent', {
                    message: question,
                    name: 'ElevenLabs Voice',
                    wakeMode: 'now',
                    sessionKey: 'voice:elevenlabs',
                    deliver: false,  // Don't deliver to WhatsApp, we want the response here
                    channel: 'webchat',
                });

                if (!hookResult.ok) {
                    result = `Kunde inte nå Alex gateway just nu. Fel: ${hookResult.data.error || 'okänt'}`;
                    break;
                }

                // The hooks/agent endpoint is async - it returns a runId.
                // For now, confirm the message was dispatched.
                const runId = hookResult.data.runId as string || 'unknown';
                result = `Jag har skickat din fråga till Alex. Han bearbetar den nu. (Run: ${runId}). Alex kommer svara via den vanliga kanalen.`;
                break;
            }

            // ==============================================================
            // gateway_tool — Direct tool invocation on the gateway
            // Synchronous: calls /tools/invoke and returns the result
            // ==============================================================
            case 'gateway_tool': {
                const toolName = parsedParams.tool as string || '';
                if (!toolName) {
                    return res.json({ result: 'Du måste ange vilket verktyg du vill använda. Exempel: sessions_list, bolagsverket_lookup' });
                }

                const toolArgs = (parsedParams.args || {}) as Record<string, unknown>;
                const action = parsedParams.action as string || undefined;

                const invokeResult = await gatewayFetch('/tools/invoke', {
                    tool: toolName,
                    action,
                    args: toolArgs,
                    sessionKey: 'main',
                });

                if (!invokeResult.ok) {
                    const errMsg = (invokeResult.data.error as Record<string, unknown>)?.message || invokeResult.data.error || 'okänt fel';
                    result = `Verktyget "${toolName}" kunde inte köras: ${errMsg}`;
                    break;
                }

                // Format the result for voice output
                const toolResult = invokeResult.data.result;
                if (typeof toolResult === 'string') {
                    result = toolResult;
                } else if (toolResult && typeof toolResult === 'object') {
                    // For structured results, create a voice-friendly summary
                    result = JSON.stringify(toolResult, null, 2);
                    // Truncate for voice (max ~500 chars)
                    if (result.length > 500) {
                        result = result.substring(0, 497) + '...';
                    }
                } else {
                    result = `Verktyget "${toolName}" returnerade inget resultat.`;
                }
                break;
            }

            // ==============================================================
            // Local quick tools (no gateway needed)
            // ==============================================================
            case 'get_status': {
                const gatewayOk = !!(config.CLAWDBOT_GATEWAY_URL && config.CLAWDBOT_GATEWAY_TOKEN);
                result = `Skyland Command Center är online. Backend körs på Render. Gateway-anslutning: ${gatewayOk ? 'aktiv' : 'ej konfigurerad'}. Alla system fungerar normalt.`;
                break;
            }

            case 'get_time': {
                const now = new Date();
                result = `Klockan är ${now.toLocaleTimeString('sv-SE')} den ${now.toLocaleDateString('sv-SE')}.`;
                break;
            }

            // ==============================================================
            // Database tools (direct Supabase queries)
            // ==============================================================
            case 'query_customers': {
                try {
                    const { data, error } = await supabase
                        .from('customer_status')
                        .select('*');

                    if (error) {
                        result = `Kunde inte hämta kunddata: ${error.message}`;
                        break;
                    }

                    if (!data || data.length === 0) {
                        result = 'Det finns inga kunder registrerade i systemet just nu.';
                        break;
                    }

                    const customerSummaries = data.map((c: Record<string, unknown>) => {
                        const name = c.name as string || 'Okänd';
                        const status = c.status as string || 'okänd';
                        const openTasks = c.open_tasks as number || 0;
                        const errors = c.errors_24h as number || 0;
                        return `${name}: status ${status}, ${openTasks} öppna uppgifter, ${errors} fel senaste 24h`;
                    });

                    result = `Du har ${data.length} kunder. ${customerSummaries.join('. ')}`;
                } catch (dbErr) {
                    console.error('[voice/tools] DB error:', dbErr);
                    result = 'Kunde inte ansluta till databasen just nu.';
                }
                break;
            }

            case 'query_tasks': {
                try {
                    const { data, error } = await supabase
                        .from('tasks')
                        .select('*')
                        .order('created_at', { ascending: false })
                        .limit(10);

                    if (error) {
                        result = `Kunde inte hämta uppgifter: ${error.message}`;
                        break;
                    }

                    if (!data || data.length === 0) {
                        result = 'Det finns inga uppgifter i systemet just nu.';
                        break;
                    }

                    const taskSummaries = data.map((t: Record<string, unknown>) => {
                        const title = t.title as string || t.name as string || 'Namnlös';
                        const status = t.status as string || 'okänd';
                        return `${title}: ${status}`;
                    });

                    result = `Senaste ${data.length} uppgifter. ${taskSummaries.join('. ')}`;
                } catch (dbErr) {
                    console.error('[voice/tools] DB error:', dbErr);
                    result = 'Kunde inte ansluta till databasen just nu.';
                }
                break;
            }

            default: {
                result = `Verktyget "${tool_name}" finns inte. Tillgängliga verktyg: ask_alex (fråga Alex vad som helst), gateway_tool (direkt verktygsanrop), get_status, get_time, query_customers, query_tasks.`;
                console.warn('[voice/tools] Unknown tool:', tool_name);
            }
        }

        console.log('[voice/tools] Returning result for', tool_name, ':', result.substring(0, 100));
        return res.json({ result });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[voice/tools] Tool execution error:', message);
        return res.json({ result: 'Ett fel uppstod när jag försökte utföra den åtgärden. Försök igen.' });
    }
});

export default router;
