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

export default router;
