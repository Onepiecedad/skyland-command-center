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
import { runAlexChat } from '../services/alexBrain';

const router = Router();

// ============================================================================
// Helpers
// ============================================================================

const GATEWAY_TIMEOUT_MS = 30_000; // 30s max wait for gateway responses

// Tracks an in-flight ask_alex run so a follow-up call ("hur går det?") can
// pick up the finished answer instead of dispatching a duplicate run.
let voicePendingRun: { historyKey: string; at: number } | null = null;

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
// Activity logging — persist voice-call outcomes so they surface in the SCC
// dashboard. Previously NO branch in /tools wrote to the DB, so bookings and
// other tool calls made during a call vanished. This is OBSERVE-level logging
// (per AGENT_POLICY) and is best-effort: a logging failure must never break
// the voice response the caller is waiting on.
// ============================================================================

// severity values must match the activities.severity CHECK constraint
// (schema.sql): only 'info', 'warn', 'error' are accepted.
interface VoiceActivityInput {
    action: string;
    eventType?: string;
    severity?: 'info' | 'warn' | 'error';
    details: Record<string, unknown>;
}

async function logVoiceActivity(input: VoiceActivityInput): Promise<void> {
    try {
        const { error } = await supabase.from('activities').insert({
            customer_id: null,
            agent: 'voice',
            action: input.action,
            event_type: input.eventType ?? 'voice',
            severity: input.severity ?? 'info',
            autonomy_level: 'OBSERVE',
            details: input.details,
        });
        if (error) {
            console.error('[voice/activity] Insert failed:', error.message);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[voice/activity] Unexpected logging error:', message);
    }
}

// ============================================================================
// Server-Alex-fallback — när gatewayen (Joakims dator) inte nås körs frågan
// genom SAMMA pipeline som textchatten (services/alexBrain: systemprompt +
// ALEX_TOOLS + messages-loggning). Rullande konversation per instans så att
// följdfrågor i samma samtal behåller kontext; nollställs efter 15 min tystnad.
// ============================================================================

const VOICE_CONVO_TTL_MS = 15 * 60_000;
let voiceConvo: { id: string; lastAt: number } | null = null;

async function askServerAlex(question: string): Promise<string> {
    const now = Date.now();
    if (!voiceConvo || now - voiceConvo.lastAt > VOICE_CONVO_TTL_MS) {
        voiceConvo = { id: crypto.randomUUID(), lastAt: now };
    }
    voiceConvo.lastAt = now;

    try {
        const brain = await runAlexChat({
            message: `RÖSTSAMTAL (svara kort och talvänligt, max några meningar, ingen markdown): ${question}`,
            channel: 'voice',
            conversation_id: voiceConvo.id,
        });
        const text = brain.response;
        return text.length > 1500 ? text.substring(0, 1497) + '...' : text;
    } catch (err) {
        console.error('[voice/ask_alex] server-Alex fallback failed:', err);
        return 'Jag kunde inte behandla frågan just nu. Försök igen om en stund.';
    }
}

// ============================================================================
// Cal.com booking — the voice agent's book_appointment tool calls this.
// Books directly against a configured Cal.com event type (v2 API) so SCC
// owns the booking outcome instead of it happening outside the system.
// ============================================================================

interface BookAppointmentArgs {
    name?: string;
    email?: string;
    start?: string; // ISO 8601 start time
    phone?: string;
    notes?: string;
    timeZone?: string;
    sessionUuid?: string;
}

interface BookAppointmentResult {
    ok: boolean;
    bookingId?: string | number;
    bookingUid?: string;
    start?: string;
    error?: string;
}

async function bookCalcomAppointment(args: BookAppointmentArgs): Promise<BookAppointmentResult> {
    const apiKey = config.CALCOM_API_KEY;
    const eventTypeId = config.CALCOM_EVENT_TYPE_ID;

    if (!apiKey || !eventTypeId) {
        return { ok: false, error: 'Cal.com är inte konfigurerat (CALCOM_API_KEY / CALCOM_EVENT_TYPE_ID saknas).' };
    }
    if (!args.start) {
        return { ok: false, error: 'Bokningen saknar starttid.' };
    }
    if (!args.email || !args.name) {
        return { ok: false, error: 'Bokningen saknar namn eller e-postadress.' };
    }

    const url = `${config.CALCOM_API_BASE_URL}/bookings`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'cal-api-version': '2024-08-13',
            },
            body: JSON.stringify({
                eventTypeId,
                start: args.start,
                attendee: {
                    name: args.name,
                    email: args.email,
                    timeZone: args.timeZone || 'Europe/Stockholm',
                    ...(args.phone ? { phoneNumber: args.phone } : {}),
                },
                ...(args.notes ? { bookingFieldsResponses: { notes: args.notes } } : {}),
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

        if (!response.ok) {
            const errMsg = ((payload.error as Record<string, unknown>)?.message as string)
                || (payload.message as string)
                || `HTTP ${response.status}`;
            console.error('[voice/calcom] Booking failed:', errMsg);
            return { ok: false, error: errMsg };
        }

        const data = (payload.data ?? payload) as Record<string, unknown>;
        return {
            ok: true,
            bookingId: (data.id as string | number) ?? undefined,
            bookingUid: (data.uid as string) ?? undefined,
            start: (data.start as string) ?? args.start,
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[voice/calcom] Error:', message);
        return { ok: false, error: `Cal.com ej nåbar: ${message}` };
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
// POST /api/v1/voice/tts — berättarröst för den guidade rundturen.
// Använder SAMMA ElevenLabs-röst som Alex-agenten (voice_id hämtas från
// agentkonfigen och cachas) så att rundturen bokstavligen berättas av Alex.
// ============================================================================
let cachedVoiceId: string | null = null;

router.post('/tts', async (req: Request, res: Response) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 700) : '';
    if (!text) {
        return res.status(400).json({ error: 'text is required' });
    }
    const apiKey = config.ELEVENLABS_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'ELEVENLABS_API_KEY not configured' });
    }
    try {
        if (!cachedVoiceId && config.ELEVENLABS_AGENT_ID) {
            const agentResp = await fetch(
                `https://api.elevenlabs.io/v1/convai/agents/${config.ELEVENLABS_AGENT_ID}`,
                { headers: { 'xi-api-key': apiKey } }
            );
            if (agentResp.ok) {
                const agent = await agentResp.json() as { conversation_config?: { tts?: { voice_id?: string } } };
                cachedVoiceId = agent.conversation_config?.tts?.voice_id ?? null;
            }
        }
        const voiceId = cachedVoiceId ?? 'EXAVITQu4vr4xnSDxMaL';
        const ttsResp = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
            {
                method: 'POST',
                headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    model_id: 'eleven_multilingual_v2',
                    // Livligare leverans än default: lägre stability = mer dynamik,
                    // lite style = mindre uppläsnings-monotoni.
                    voice_settings: {
                        stability: 0.42,
                        similarity_boost: 0.85,
                        style: 0.25,
                        use_speaker_boost: true,
                    },
                }),
            }
        );
        if (!ttsResp.ok) {
            console.error('[voice/tts] ElevenLabs TTS failed:', ttsResp.status);
            return res.status(502).json({ error: 'TTS generation failed' });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(Buffer.from(await ttsResp.arrayBuffer()));
    } catch (err) {
        console.error('[voice/tts] error:', err instanceof Error ? err.message : err);
        return res.status(500).json({ error: 'Internal TTS error' });
    }
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
    let { tool_name, params } = req.body;

    // ElevenLabs' ask_alex webhook posts { question } at top level without
    // tool_name — map it. Same for { tool: ... } from openclaw_tools variants.
    if (!tool_name && typeof req.body.question === 'string') {
        tool_name = 'ask_alex';
        params = { question: req.body.question };
    }

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

                const PENDING_TTL_MS = 10 * 60_000;

                // Each voice question gets its OWN fresh session so dispatches
                // never queue up behind each other on a shared key. The first
                // assistant message in that session is THIS question's answer.
                const VOICE_SESSION = `hook:voice-${Date.now()}`;
                const HISTORY_SESSION = `agent:main:${VOICE_SESSION}`;

                // Helper: read assistant message count + last assistant text
                const readHistoryOf = async (historyKey: string): Promise<{ count: number; lastText: string }> => {
                    const h = await gatewayFetch('/tools/invoke', {
                        tool: 'sessions_history',
                        args: { sessionKey: historyKey, limit: 20 },
                        sessionKey: 'main',
                    });
                    try {
                        const content = (h.data.result as { content?: { text?: string }[] })?.content;
                        const parsed = JSON.parse(content?.[0]?.text || '{}');
                        const msgs: { role: string; content: unknown }[] = parsed.messages || [];
                        const assistants = msgs.filter(m => m.role === 'assistant');
                        const last = assistants[assistants.length - 1];
                        let text = '';
                        if (last) {
                            text = typeof last.content === 'string'
                                ? last.content
                                : (last.content as { type?: string; text?: string }[])
                                    .filter(c => c?.type === 'text' && c.text)
                                    .map(c => c.text)
                                    .join(' ');
                        }
                        return { count: assistants.length, lastText: text };
                    } catch {
                        return { count: -1, lastText: '' };
                    }
                };

                // Poll a session's history for its first/next assistant message
                const pollForAnswer = async (historyKey: string, baseline: number, maxWaitMs: number): Promise<string> => {
                    const POLL_INTERVAL_MS = 2500;
                    const startedAt = Date.now();
                    while (Date.now() - startedAt < maxWaitMs) {
                        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                        const now = await readHistoryOf(historyKey);
                        if (now.count > baseline && now.lastText) return now.lastText;
                    }
                    return '';
                };
                const trimForVoice = (s: string) => s.length > 1500 ? s.substring(0, 1497) + '...' : s;

                // Follow-up like "hur går det?" — a prior long task is still
                // pending. Don't dispatch a new run; resume waiting on it.
                const isFollowUp = /hur går det|är du klar|färdig|status|klart än/i.test(question);
                if (voicePendingRun && Date.now() - voicePendingRun.at < PENDING_TTL_MS && isFollowUp) {
                    const done = await readHistoryOf(voicePendingRun.historyKey);
                    if (done.count > 0 && done.lastText) {
                        const txt = done.lastText;
                        voicePendingRun = null;
                        result = trimForVoice(txt);
                        break;
                    }
                    const late = await pollForAnswer(voicePendingRun.historyKey, 0, 50_000);
                    if (late) {
                        voicePendingRun = null;
                        result = trimForVoice(late);
                    } else {
                        result = 'Jag jobbar fortfarande på det. Fråga igen om en liten stund.';
                    }
                    break;
                }

                // RUNDTUR: helt deterministisk — inget LLM-varv. LLM:et kallar verktyget
                // ibland och fumlar ibland ("jag kunde inte starta rundturen" trots att
                // halva kedjan gick). Kod, inte instruktion: matcha intentet, fyra
                // eventet direkt, svara med fast bekräftelse. Kan inte misslyckas.
                const TOUR_INTENT = /rundtur|visa mig runt|guida mig (genom|runt)|genomgång av (systemet|dashboarden)/i;
                if (TOUR_INTENT.test(question)) {
                    const { emitSystemEvent } = await import('./eventStream');
                    emitSystemEvent('ui_action', { action: 'tour' }, 'alex');
                    result = 'Klart, rundturen startar nu på skärmen. Jag berättar om varje vy och går vidare automatiskt. Vi hörs när den är klar!';
                    break;
                }

                // ÖVRIG UI-STYRNING (vybyte, öppna kontaktkort) går ALLTID till
                // server-Alex — verktyget navigate_ui finns bara där (gateway-Alex
                // kan inte styra skärmen).
                const UI_INTENT = /byt vy|presentera (dig|systemet)|(visa|öppna|ta fram)[^.]*\b(crm|kortet|kort för|kontoret|dashboard|vyn|pipelinen)/i;
                if (UI_INTENT.test(question)) {
                    result = await askServerAlex(question);
                    break;
                }

                // Dispatch to the MAIN agent in a FRESH session — same brain,
                // skills and tool permissions as WhatsApp/webchat.
                const hookToken = config.OPENCLAW_HOOK_TOKEN || config.CLAWDBOT_GATEWAY_TOKEN;
                let dispatched = false;
                if (!hookToken) {
                    // Ingen gateway konfigurerad (server-läge) — hoppa direkt till server-Alex.
                    result = await askServerAlex(question);
                    break;
                }
                try {
                    const resp = await fetch(`${config.CLAWDBOT_GATEWAY_URL}/hooks/agent`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${hookToken}`,
                        },
                        body: JSON.stringify({
                            message: `RÖSTSAMTAL (svara kort och talvänligt, max några meningar): ${question}`,
                            name: 'ElevenLabs Voice',
                            wakeMode: 'now',
                            sessionKey: VOICE_SESSION,
                            agentId: 'main',
                            deliver: false,
                            // Voice input is the owner (Joakim) speaking — trusted, like
                            // webchat/WhatsApp. Without this the gateway wraps the question
                            // in an "EXTERNAL UNTRUSTED source" notice, which makes the model
                            // intermittently refuse to act (e.g. "I don't have mail access").
                            allowUnsafeExternalContent: true,
                        }),
                    });
                    dispatched = resp.ok;
                    if (!resp.ok) {
                        console.error('[voice/ask_alex] hook dispatch failed:', resp.status, await resp.text());
                    }
                } catch (err) {
                    console.error('[voice/ask_alex] hook dispatch error:', err);
                }

                if (!dispatched) {
                    // Gatewayen (Joakims dator) nås inte — fall tillbaka till server-Alex:
                    // samma pipeline, systemprompt och CRM-verktyg som textchatten.
                    result = await askServerAlex(question);
                    break;
                }

                // Fresh session → baseline 0, the answer is the first assistant msg
                const answer = await pollForAnswer(HISTORY_SESSION, 0, 50_000);

                if (answer) {
                    voicePendingRun = null;
                    result = trimForVoice(answer);
                } else {
                    // Long task — remember the session so a follow-up retrieves it
                    voicePendingRun = { historyKey: HISTORY_SESSION, at: Date.now() };
                    result = 'Jag jobbar fortfarande på det. Fråga "hur går det?" om en liten stund så får du svaret.';
                }
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

                // Persist gateway tool calls so nothing done during a call is
                // lost. Booking-related tools are tagged as booking events so
                // they surface distinctly in the dashboard even when the agent
                // books via the gateway rather than book_appointment.
                const isBooking = /book|appointment|calcom|cal\.com|boka|bokning/i.test(toolName);
                await logVoiceActivity({
                    action: isBooking ? 'voice.booking.gateway' : 'voice.gateway_tool',
                    eventType: isBooking ? 'booking' : 'voice',
                    severity: 'info',
                    details: {
                        source: 'voice_call',
                        tool: toolName,
                        action,
                        args: toolArgs,
                        result_preview: typeof result === 'string' ? result.substring(0, 500) : undefined,
                    },
                });
                break;
            }

            // ==============================================================
            // book_appointment — Books a Cal.com appointment AND logs the
            // outcome as an activity so it appears in the SCC dashboard.
            // This closes the voice → booking → activity loop.
            // ==============================================================
            case 'book_appointment': {
                const bookingArgs: BookAppointmentArgs = {
                    name: (parsedParams.name as string) || (parsedParams.namn as string) || undefined,
                    email: (parsedParams.email as string) || (parsedParams.epost as string) || undefined,
                    start: (parsedParams.start as string) || (parsedParams.starttid as string) || (parsedParams.time as string) || undefined,
                    phone: (parsedParams.phone as string) || (parsedParams.telefon as string) || undefined,
                    notes: (parsedParams.notes as string) || (parsedParams.meddelande as string) || undefined,
                    timeZone: (parsedParams.timeZone as string) || (parsedParams.tidszon as string) || undefined,
                    sessionUuid: (parsedParams.session_uuid as string) || (parsedParams.sessionUuid as string) || undefined,
                };

                const booking = await bookCalcomAppointment(bookingArgs);

                if (booking.ok) {
                    await logVoiceActivity({
                        action: 'voice.booking.created',
                        eventType: 'booking',
                        severity: 'info',
                        details: {
                            source: 'voice_call',
                            calcom_booking_id: booking.bookingId,
                            calcom_booking_uid: booking.bookingUid,
                            start: booking.start,
                            name: bookingArgs.name,
                            email: bookingArgs.email,
                            phone: bookingArgs.phone,
                            session_uuid: bookingArgs.sessionUuid,
                        },
                    });
                    const when = booking.start
                        ? new Date(booking.start).toLocaleString('sv-SE', { timeZone: bookingArgs.timeZone || 'Europe/Stockholm' })
                        : 'den valda tiden';
                    result = `Bokningen är klar för ${bookingArgs.name} (${bookingArgs.email}) den ${when}. En bekräftelse har skickats.`;
                } else {
                    // Log the failed attempt too — a missed booking is a signal
                    // the operator wants to see, not something to swallow.
                    await logVoiceActivity({
                        action: 'voice.booking.failed',
                        eventType: 'booking',
                        severity: 'warn',
                        details: {
                            source: 'voice_call',
                            error: booking.error,
                            name: bookingArgs.name,
                            email: bookingArgs.email,
                            start: bookingArgs.start,
                            session_uuid: bookingArgs.sessionUuid,
                        },
                    });
                    result = `Jag kunde inte slutföra bokningen: ${booking.error}. Vill du att jag försöker igen med andra uppgifter?`;
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
                result = `Verktyget "${tool_name}" finns inte. Tillgängliga verktyg: ask_alex (fråga Alex vad som helst), gateway_tool (direkt verktygsanrop), book_appointment (boka möte i Cal.com), get_status, get_time, query_customers, query_tasks.`;
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
