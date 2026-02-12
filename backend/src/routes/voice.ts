/**
 * Voice Router — ElevenLabs Conversational AI Integration
 *
 * Provides a signed-URL endpoint so the frontend can connect
 * to ElevenLabs without exposing the API key client-side.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

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
// Returns whether ElevenLabs is configured
// ============================================================================
router.get('/status', (_req: Request, res: Response) => {
    const configured = !!(config.ELEVENLABS_API_KEY && config.ELEVENLABS_AGENT_ID);
    return res.json({
        configured,
        agentId: configured ? config.ELEVENLABS_AGENT_ID : null,
    });
});

// ============================================================================
// POST /api/v1/voice/tools
// Receives tool-call webhooks from ElevenLabs Conversational AI
// The agent sends { tool_name, params } when it needs to execute a tool
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
            case 'web_search': {
                const query = parsedParams.query as string || parsedParams.raw as string || '';
                if (!query) {
                    return res.json({ result: 'Jag behöver en sökfråga. Vad vill du att jag söker efter?' });
                }
                // Use OpenAI for web search summary (or could use a search API)
                const openaiKey = config.OPENAI_API_KEY;
                if (!openaiKey) {
                    return res.json({ result: 'Webbsökning är inte konfigurerad just nu. Jag kan fortfarande hjälpa dig med andra saker!' });
                }
                const searchResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${openaiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: 'Du är en hjälpsam assistent. Svara kort och koncist på svenska.' },
                            { role: 'user', content: query },
                        ],
                        max_tokens: 300,
                    }),
                });
                if (!searchResponse.ok) {
                    const errBody = await searchResponse.text();
                    console.error('[voice/tools] OpenAI error:', errBody);
                    return res.json({ result: 'Sökningen misslyckades tillfälligt. Försök igen om en stund.' });
                }
                const searchData = await searchResponse.json() as {
                    choices: Array<{ message: { content: string } }>;
                };
                result = searchData.choices?.[0]?.message?.content || 'Inget svar från sökningen.';
                break;
            }

            case 'get_status': {
                // Return SCC system status
                result = 'Skyland Command Center är online. Backend körs på Render. Alla system fungerar normalt.';
                break;
            }

            case 'get_time': {
                const now = new Date();
                result = `Klockan är ${now.toLocaleTimeString('sv-SE')} den ${now.toLocaleDateString('sv-SE')}.`;
                break;
            }

            default: {
                result = `Verktyget "${tool_name}" är inte implementerat ännu. Jag kan hjälpa med: web_search, get_status, get_time.`;
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
