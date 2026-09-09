import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { supabase } from '../services/supabase';
import { logger } from '../services/logger';
import { chatRequestSchema } from '../schemas/chat';
import { runAlexChat, AlexBrainError } from '../services/alexBrain';

const router = Router();

// POST /chat - Alex chat endpoint. Själva pipelinen bor i services/alexBrain.ts
// (delas med rösten — /voice/tools → ask_alex-fallback).
router.post('/chat', async (req: Request, res: Response) => {
    try {
        const parsed = chatRequestSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { message, channel, customer_id } = parsed.data;
        const conversation_id = parsed.data.conversation_id ?? crypto.randomUUID();

        const result = await runAlexChat({
            message,
            channel,
            conversation_id,
            customer_id: customer_id || null,
        });

        return res.json(result);

    } catch (err) {
        if (err instanceof AlexBrainError) {
            return res.status(500).json({
                error: err.code === 'adapter' ? 'LLM adapter not configured' : 'LLM call failed',
                details: err.details
            });
        }
        logger.error('chat', 'Chat error', { error: err instanceof Error ? err.message : err });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /chat/history - fetch messages for a conversation
router.get('/chat/history', async (req: Request, res: Response) => {
    try {
        const { conversation_id } = req.query;

        if (!conversation_id || typeof conversation_id !== 'string') {
            return res.status(400).json({ error: 'conversation_id is required' });
        }

        // Validate UUID format
        const uuidSchema = z.string().uuid();
        const uuidParsed = uuidSchema.safeParse(conversation_id);

        if (!uuidParsed.success) {
            return res.status(400).json({ error: 'Invalid conversation_id format' });
        }

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('chat', 'Error fetching chat history', { error: error.message });
            return res.status(500).json({ error: error.message });
        }

        return res.json({ messages: data, conversation_id });

    } catch (err) {
        logger.error('chat', 'Chat history error', { error: err instanceof Error ? err.message : err });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /chat/stream — samma pipeline, men svaret strömmar.
 *
 * Varför: rösten fick vänta på hela svaret innan den kunde börja läsa, vilket
 * gjorde varje fråga fem till tjugo sekunder tyst. Nu skickas texten bit för
 * bit medan modellen skriver, så uppläsningen kan starta vid första meningen.
 *
 * Formen är SSE-rader men över ett vanligt POST-svar (EventSource kan inte
 * posta): { type: 'delta' | 'round' | 'final' | 'error' }. 'round' betyder att
 * en ny LLM-runda börjat och att det som strömmats hittills var ett förspel
 * före ett verktygsanrop — nollställ bufferten. 'final' bär hela svaret,
 * conversation_id och ui_only, precis som det icke-strömmande svaret.
 */
router.post('/stream', async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { message, channel, customer_id } = parsed.data;
    const conversation_id = parsed.data.conversation_id ?? crypto.randomUUID();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    let lastRound = 1;
    try {
        const result = await runAlexChat({
            message,
            channel,
            conversation_id,
            customer_id: customer_id || null,
            onDelta: ({ text, round }) => {
                if (round !== lastRound) {
                    lastRound = round;
                    send({ type: 'round', round });
                }
                send({ type: 'delta', text });
            },
        });
        send({
            type: 'final',
            response: result.response,
            conversation_id: result.conversation_id,
            ui_only: result.ui_only,
            tool_calls: result.tool_calls,
            incomplete: result.incomplete,
        });
    } catch (err) {
        const message = err instanceof AlexBrainError
            ? (err.code === 'adapter' ? 'LLM adapter not configured' : 'LLM call failed')
            : 'Internal server error';
        logger.error('chat', 'Streaming chat failed', { error: err instanceof Error ? err.message : err });
        send({ type: 'error', error: message });
    } finally {
        if (!closed) res.end();
    }
    return;
});

export default router;
