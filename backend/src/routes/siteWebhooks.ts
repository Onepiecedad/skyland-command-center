/**
 * Sajt-webhookar för skylandai.se (SCC-48) — ersätter fem n8n-flöden som dog
 * när n8n Cloud pausades: session_init, track_event, void_submission
 * (inkl. rag_query), session_status och voice_call_ended.
 *
 * Kontrakten (payload in, JSON ut) är bevarade 1:1 från n8n så sajtens JS
 * bara behöver byta bas-URL. Publika endpoints (session-init, track-event,
 * void-submission, session-status) skyddas av CORS + rate limit; sessions-
 * UUID:t är nyckeln, precis som förr. voice-call-ended (från Fly-proxyn) och
 * rag-query (server-till-server) kräver token.
 *
 * Monteras på /api/v1/webhooks/site FÖRE global auth.
 */
import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { supabase, websiteSupabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';
import { ragQuery } from '../services/siteRag';
import { ingestLead } from './leads';

const router = Router();
const db = () => websiteSupabase ?? supabase;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Publika endpoints: telemetri/polling är frekvent men aldrig >60/min från en besökare.
const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { ok: false, error: 'rate limited' } });
// Formuläret: en människa skickar inte fler än så.
const formLimiter = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, message: { status: 'error', error_code: 'RATE_LIMITED', message: 'För många försök, vänta en stund.' } });

function tokenAuth(envName: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const expected = process.env[envName] || process.env.LEADS_INTAKE_TOKEN || config.SCC_API_TOKEN;
        const bearer = (req.headers.authorization || '').split(' ')[1];
        const header = req.headers['x-skyland-key'];
        const token = bearer || (typeof header === 'string' ? header : '') || (typeof req.query.token === 'string' ? req.query.token : '');
        if (!token || token !== expected) { res.status(401).json({ error: 'Ogiltig eller saknad token' }); return; }
        next();
    };
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function upsertSession(row: { session_uuid: string; user_agent?: string | null; entry_module?: string | null }) {
    const { data, error } = await db().from('sessions').upsert(row, { onConflict: 'session_uuid' }).select().single();
    if (error) throw new Error(`sessions upsert: ${error.message}`);
    return data;
}

// ---------------------------------------------------------------------------
// POST /session-init  { session_uuid, user_agent, entry_module }
// n8n svarade med "allIncomingItems" → array med Supabase-raden. Bevarat.
// ---------------------------------------------------------------------------
router.post('/session-init', publicLimiter, async (req: Request, res: Response) => {
    const b = req.body || {};
    const sid = str(b.session_uuid, 64).toLowerCase();
    if (!UUID_V4.test(sid)) return res.status(400).json([{ error: 'invalid session_uuid' }]);
    try {
        const row = await upsertSession({ session_uuid: sid, user_agent: str(b.user_agent, 400) || null, entry_module: str(b.entry_module, 40) || 'core' });
        return res.json([row]);
    } catch (e) {
        logger.error('site.session', 'session-init failed', { error: String(e) });
        return res.status(500).json([{ error: 'internal' }]);
    }
});

// ---------------------------------------------------------------------------
// POST /track-event  { session_uuid, events: [{type, data}] }
// Anonym telemetri: whitelist på typ och datafält, cap 25 per batch.
// Ingen IP, ingen user-agent, ingen fritext lagras.
// ---------------------------------------------------------------------------
export const ALLOWED_EVENTS = new Set([
    'page_view', 'lang', 'video_play', 'video_complete', 'starter_click',
    'voice_start', 'voice_end', 'voice_error',
    'form_start', 'form_submit', 'form_error',
    'roi_input', 'cta_book_click',
]);

export function sanitizeEvents(body: Record<string, unknown>): Array<{ session_uuid: string; type: string; data: Record<string, unknown> }> | null {
    const sid = typeof body.session_uuid === 'string' ? body.session_uuid : '';
    if (!UUID_V4.test(sid)) return null;
    const raw = Array.isArray(body.events) ? body.events.slice(0, 25) : [];
    const rows: Array<{ session_uuid: string; type: string; data: Record<string, unknown> }> = [];
    for (const ev of raw as Array<Record<string, unknown>>) {
        if (!ev || typeof ev.type !== 'string' || !ALLOWED_EVENTS.has(ev.type)) continue;
        const d = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
        const clean: Record<string, unknown> = {};
        if (typeof d.module === 'string') clean.module = d.module.slice(0, 20);
        if (typeof d.lang === 'string') clean.lang = d.lang.slice(0, 5);
        if (typeof d.starter === 'string') clean.starter = d.starter.slice(0, 80);
        if (typeof d.video === 'string') clean.video = d.video.slice(0, 40);
        if (typeof d.hours === 'number' && Number.isFinite(d.hours)) clean.hours = Math.max(0, Math.min(200, d.hours));
        if (typeof d.rate === 'number' && Number.isFinite(d.rate)) clean.rate = Math.max(0, Math.min(10000, d.rate));
        if (typeof d.seconds === 'number' && Number.isFinite(d.seconds)) clean.seconds = Math.max(0, Math.min(86400, Math.round(d.seconds)));
        rows.push({ session_uuid: sid.toLowerCase(), type: ev.type, data: clean });
    }
    return rows.length ? rows : null;
}

router.post('/track-event', publicLimiter, async (req: Request, res: Response) => {
    const rows = sanitizeEvents(req.body || {});
    if (!rows) return res.status(400).json({ ok: false });
    const { error } = await db().from('events').insert(rows);
    if (error) { logger.warn('site.track', 'events insert failed', { error: error.message }); return res.status(500).json({ ok: false }); }
    return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /session-status  { session_uuid }  → { session_uuid, prospect, events }
// ---------------------------------------------------------------------------
router.post('/session-status', publicLimiter, async (req: Request, res: Response) => {
    const sid = str(req.body?.session_uuid, 64);
    if (!UUID_V4.test(sid)) return res.status(400).json({ error: 'invalid session_uuid' });
    try {
        const [{ data: prospects }, { data: rows }] = await Promise.all([
            db().from('prospects').select('name,company,email,score,created_at').eq('session_uuid', sid).order('created_at', { ascending: false }).limit(1),
            db().from('interactions').select('type,payload,created_at').eq('session_uuid', sid).order('created_at', { ascending: true }).limit(20),
        ]);
        const prospect = prospects?.[0] ?? null;
        const events = (rows ?? []).map(r => {
            const p = (r.payload || {}) as Record<string, unknown>;
            return {
                type: r.type,
                created_at: r.created_at,
                ai_response: r.type === 'form' ? (p.ai_response ?? null) : null,
                summary: r.type === 'voice' ? (p.summary ?? null) : null,
                duration_seconds: r.type === 'voice' ? (p.duration_seconds ?? null) : null,
                score: p.score !== undefined ? p.score : null,
            };
        });
        return res.json({ session_uuid: sid, prospect, events });
    } catch (e) {
        logger.error('site.status', 'session-status failed', { error: String(e) });
        return res.status(500).json({ error: 'internal' });
    }
});

// ---------------------------------------------------------------------------
// POST /void-submission — formuläret "The Void"
// Validera → upsert session → insert prospect → poäng → RAG → GPT-svar →
// insert interaction → lead till SCC (in-process) → svara.
// ---------------------------------------------------------------------------
export function scoreLead(o: { company: string; website: string; phone: string; message: string }): number {
    let score = 0;
    if (o.company && o.company.length > 1) score += 10;
    if (o.website && o.website.length > 4) score += 10;
    if (o.phone && o.phone.length > 5) score += 5;
    const wordCount = o.message.split(/\s+/).length;
    if (wordCount >= 30) score += 15; else if (wordCount >= 15) score += 10; else if (wordCount >= 10) score += 5;
    const msg = o.message.toLowerCase();
    const keywords = ['crm', 'automation', 'voice', 'agent', 'chatbot', 'hemsida', 'integration', 'n8n', 'supabase'];
    score += keywords.filter(k => msg.includes(k)).length * 5;
    return Math.min(score, 100);
}

const VOID_SYSTEM_PROMPT = `**KRITISK FÖRSTA REGEL — språk:**
Du MÅSTE svara på det språk som anges i fältet "Svarsspråk". Om Svarsspråk är ENGLISH, svara på engelska. Om SWEDISH, svara på svenska. Inga undantag.

---

Du är en pragmatisk AI-arkitekt som snabbt och konkret analyserar ett inkommande lead och föreslår lösningar. Din ton är direkt, professionell och helt utan marketing-fluff.

## 1. Lyssna på det EXAKTA problemet
Läs noga VAD kunden vill ha hjälp med.
- Om kunden vill ha "fler kunder", prata om lead generation, konvertering och uppföljning.
- Om kunden pratar om "tidsbrist" eller "missade samtal", prata om automatiska bokningssystem och kundtjänst.
Ditt svar MÅSTE matcha kundens specifika behov. Prata aldrig om admin/bokningssystem om kunden explicit ber om mer försäljning.

## 2. Format: Två lösningar
Ditt svar ska alltid innehålla exakt 2 olika AI-lösningar/angreppssätt på kundens specifika problem.
- Extremt kortfattat: Max 3-4 meningar totalt.
- Skriv i löptext (inga punktlistor, inga rubriker).
- Inga hälsningsfraser ("Hej och tack"). Gå rakt på sak.

## 3. Hur du avslutar (VIKTIGT)
- Du får INTE skriva att "vi kommer höra av oss", "jag ringer dig" eller liknande. (Systemet lägger automatiskt till detta efter din text).
- Du får INTE ställa några frågor ("Hur låter det?", "Vad tar mest tid?").
- Avsluta bara texten direkt efter att du presenterat den andra lösningen.

## 4. Komplett exempel (Följ denna längd och struktur exakt!)

INKOMMANDE MEDDELANDE:
"Hej, jag driver en massageklinik och behöver fler kunder."

DITT SVAR:
"Att hitta nya kunder tar tid som du hellre lägger på behandlingar. Vi kan lösa detta på två sätt: antingen sätter vi upp en AI-agent som dygnet runt fångar upp och konverterar hemsidebesökare till bokade tider, eller så automatiserar vi en proaktiv uppföljning via SMS med dina tidigare kunder för att snabbt fylla luckor i din kalender."

## Absolut förbjudet
- Att skriva att du ska höra av dig eller ta kontakt.
- Att ställa frågor (kunden kan inte svara i detta gränssnitt).
- Säljiga fraser som "Föreställ dig..." eller "Skräddarsydda lösningar".
- Att svara på ett annat problem än det kunden faktiskt tog upp!`;

export function detectLanguage(message: string): 'ENGLISH' | 'SWEDISH' {
    const isEnglish = /\b(the|and|is|are|we|our|can|you|help|with|have|this|that|from)\b/i.test(message) && !/[åäöÅÄÖ]/.test(message);
    return isEnglish ? 'ENGLISH' : 'SWEDISH';
}

async function chatCompletion(body: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
    if (!config.OPENAI_API_KEY) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.OPENAI_API_KEY}` },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!r.ok) { logger.warn('site.openai', `chat ${r.status}`, { text: (await r.text()).slice(0, 300) }); return null; }
        const j = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
        return j.choices?.[0]?.message?.content ?? null;
    } catch (e) {
        logger.warn('site.openai', 'chat failed', { error: String(e) });
        return null;
    } finally { clearTimeout(t); }
}

router.post('/void-submission', formLimiter, async (req: Request, res: Response) => {
    const b = req.body || {};
    const errors: string[] = [];
    const sid = str(b.session_uuid, 64);
    const name = str(b.name, 120);
    const email = str(b.email, 200).toLowerCase();
    const message = str(b.message, 5000);
    if (!sid) errors.push('session_uuid required');
    if (name.length < 2) errors.push('name required (min 2 chars)');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('valid email required');
    if (message.length < 10) errors.push('message required (min 10 chars)');
    if (sid && !UUID_V4.test(sid)) errors.push('session_uuid must be valid v4 UUID');
    if (b.consent_given !== true) errors.push('consent_given must be true');
    if (errors.length) {
        return res.status(400).json({ status: 'error', error_code: b.consent_given !== true ? 'MISSING_CONSENT' : 'INVALID_INPUT', message: errors.join('; ') });
    }
    const lead = { session_uuid: sid, name, email, company: str(b.company, 200), website: str(b.website, 300), phone: str(b.phone, 50), message };
    const fallbackText = `Tack för ditt meddelande, ${name}. Joakim återkommer personligen inom 24 timmar med ett konkret förslag baserat på det du beskrivit.`;

    try {
        await upsertSession({ session_uuid: sid });
        const { data: prospect, error: pErr } = await db().from('prospects')
            .insert({ ...lead, consent_given: true, score: 0 }).select('id,session_uuid').single();
        if (pErr || !prospect) throw new Error(`prospects insert: ${pErr?.message}`);

        const score = scoreLead(lead);
        await db().from('prospects').update({ score }).eq('id', prospect.id);

        const rag = await ragQuery(message);
        const userMessage = `Svarsspråk: ${detectLanguage(message)}\n\nBesökarens meddelande:\n"${message}"\n\nNamn: ${name}\nFöretag: ${lead.company || 'Ej angivet'}\n\nKunskapsbas-träffar:\n${JSON.stringify(rag.matches)}\n\nGenerera de 2 lösningarna i löptext enligt instruktionerna. Max 4 meningar.`;
        const ai = await chatCompletion({ model: 'gpt-4o-mini', max_tokens: 300, messages: [{ role: 'system', content: VOID_SYSTEM_PROMPT }, { role: 'user', content: userMessage }] }, 30_000);
        const aiText = ai || fallbackText;

        const { error: iErr } = await db().from('interactions').insert({
            session_uuid: sid, type: 'form',
            payload: { lead_id: prospect.id, score, best_match_similarity: rag.best_similarity, ai_response: ai || 'Fallback: Joakim återkommer inom 24 timmar.' },
        });
        if (iErr) logger.warn('site.void', 'interactions insert failed', { error: iErr.message });

        // Lead in i SCC (activities + contacts) — samma som n8n:s "Notify SCC", fast in-process.
        ingestLead({ source: 'void_form', session_uuid: sid, prospect_id: prospect.id, name, email, company: lead.company, website: lead.website, phone: lead.phone, message, score })
            .catch(e => logger.error('site.void', 'ingestLead failed', { error: String(e) }));

        return res.json({ status: 'success', lead_id: prospect.id, ai_response: aiText, best_match_similarity: rag.best_similarity });
    } catch (e) {
        logger.error('site.void', 'void-submission failed', { error: String(e) });
        return res.status(500).json({ status: 'error', error_code: 'INTERNAL_ERROR', message: 'internal error' });
    }
});

// ---------------------------------------------------------------------------
// POST /rag-query  (X-Skyland-Key / Bearer SITE_RAG_KEY)  { query, language }
// ---------------------------------------------------------------------------
router.post('/rag-query', tokenAuth('SITE_RAG_KEY'), async (req: Request, res: Response) => {
    const query = str(req.body?.query, 2000);
    if (!query) return res.status(400).json({ error: 'query is required', error_code: 'INVALID_INPUT', matches: [], query: '', best_similarity: 0 });
    return res.json(await ragQuery(query));
});

// ---------------------------------------------------------------------------
// POST /voice-call-ended  (token: SITE_VOICE_WEBHOOK_TOKEN) — från Fly-proxyn
// ---------------------------------------------------------------------------
const VOICE_SYSTEM_PROMPT = 'Du är en erfaren sales-assistent. Analysera säljsamtal och extrahera CRM-data som JSON. VIKTIGT: Samtalet är INBOUND — personen ringde själv in via hemsidan och AI-agenten Alex svarade. Skriv aldrig att agenten kontaktade eller att Alex ringde. Börja alltid summary med personens namn och företag. Fälten: person_name (string|null), company_name (string|null), industry (returnera exakt ett av dessa kategorinamn — kopiera stavningen exakt, inga varianter: Bygg & Fastighet [byggföretag, hantverkare, VVS, el, markarbete, mäklare, arkitekt, golvläggare, målare, snickare, fastighetsförvaltning] | Hotell & Besöksnäring [hotell, B&B, vandrarhem, camping, konferensanläggning, turism, resebyrå] | Livsmedel & Restaurang [restaurang, café, bar, catering, bageri, matproduktion, fruktleverantör, livsmedelsgrossist] | Skönhet & Välmående [frisör, salong, hudvård, spa, massage, naglar, tatuerare, yoga, träningsstudio, personlig tränare] | Tjänster & Konsult [revisor, jurist, designer, marknadsföring, rekrytering, IT-konsult, ekonom, copywriter, managementkonsult] | Handel & E-handel [detaljhandel, webshop, grossist, butik, klädhandel, elektronik, inredning, sportaffär] | Vård & Omsorg [tandläkare, naprapat, fysioterapeut, läkare, psykolog, äldreomsorg, barnvård, apotek, optiker] | Transport & Logistik [åkeri, spedition, budtjänst, flytt, taxi, lagerhantering, godstransport, courier] | Industri & Tillverkning [fabrik, verkstad, tillverkning, gjuteri, svetsning, mekanik, fordonsservice] | Utbildning [skola, förskola, kurs, utbildningsföretag, instruktör, folkhögskola] | Övrigt [ENBART om ingen av ovanstående stämmer — inte default] — eller null om branschen inte nämns), email (string|null), pain_points (string-array), pain_points_summary (string|null), current_process (string|null), meeting_requested (boolean), language_detected (sv|en), summary (3-5 meningar för en säljare: vem ringde in, från vilket företag, vilken bransch, vilket problem, nästa steg). Svara ENBART med valid JSON.';

export function normalizeVoicePayload(body: Record<string, any>) {
    const sessionUuid: string | null = body.session_uuid || body.metadata?.session_uuid || body.raw_payload?.session_uuid || null;
    const conversationId: string | null = body.conversation_id || body.conversationId || body.raw_payload?.conversation_id || body.raw_payload?.conversationId || null;
    const transcript: string = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    const summary: string | null = typeof body.summary === 'string' && body.summary.trim()
        ? body.summary.trim()
        : (transcript ? transcript.split('\n').slice(0, 3).join(' ').slice(0, 280) : null);
    const lines = transcript.split('\n').map(l => l.trim()).filter(Boolean);
    const extractAnswerAfter = (rx: RegExp): string | null => {
        const qi = lines.findIndex(l => l.startsWith('agent:') && rx.test(l.toLowerCase()));
        if (qi === -1) return null;
        for (let i = qi + 1; i < lines.length; i++) if (lines[i].startsWith('user:')) return lines[i].replace(/^user:\s*/i, '').trim();
        return null;
    };
    const cleanField = (v: string | null) => (v ? v.replace(/[.。]+$/g, '').trim() : null);
    const painAnswer = cleanField(extractAnswerAfter(/vad tar mest tid|mest friktion/));
    const emailMatch = transcript.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const extracted = {
        person_name: cleanField(extractAnswerAfter(/vad heter du/)),
        company_name: cleanField(extractAnswerAfter(/vad heter f[öo]retaget/)),
        industry: cleanField(extractAnswerAfter(/vilken bransch/)),
        email: emailMatch ? emailMatch[0].toLowerCase() : null,
        pain_points: painAnswer ? painAnswer.split(/,| och | samt /i).map(s => s.replace(/^eh\s+/i, '').trim()).filter(Boolean).slice(0, 8) : [],
        pain_points_summary: painAnswer,
        current_process: cleanField(extractAnswerAfter(/hur hanterar ni allt det d[äa]r idag/)),
        meeting_requested: /bokar? gärna ett möte|boka in|kalenderinbjudan|google meet-länk/i.test(transcript),
    };
    const errors: string[] = [];
    if (!sessionUuid) errors.push('session_uuid required');
    if (sessionUuid && !UUID_ANY.test(sessionUuid)) errors.push('session_uuid must be valid UUID');
    if (!conversationId) errors.push('conversation_id required');
    if (errors.length) return { ok: false as const, message: errors.join('; ') };
    return {
        ok: true as const,
        session_uuid: sessionUuid as string,
        external_call_id: conversationId as string,
        provider: 'elevenlabs',
        call_source: body.source || 'voice_call_ended',
        agent_id: body.agent_id || body.agentId || null,
        started_at: body.started_at || body.startedAt || null,
        ended_at: body.ended_at || body.endedAt || new Date().toISOString(),
        duration_seconds: body.duration_seconds || body.durationSeconds || null,
        transcript, summary,
        recording_url: body.recording_url || body.recordingUrl || null,
        extracted_data: extracted,
        metadata: body.metadata || {},
        raw_payload: body.raw_payload || body,
    };
}

/** Kör hela voice-call-ended-kedjan: session → prospect → LLM-extraktion → voice_calls → interactions → lead. */
export async function handleVoiceCallEnded(raw: Record<string, any>): Promise<{ code: number; body: Record<string, unknown> }> {
    const n = normalizeVoicePayload(raw || {});
    if (!n.ok) return { code: 400, body: { status: 'error', message: n.message } };
    try {
        await upsertSession({ session_uuid: n.session_uuid });
        const { data: prospects } = await db().from('prospects').select('id,customer_id').eq('session_uuid', n.session_uuid).order('created_at', { ascending: false }).limit(1);
        const prospect_id = prospects?.[0]?.id ?? null;
        const customer_id = prospects?.[0]?.customer_id ?? null;

        let llm: Record<string, any> | null = null;
        const content = await chatCompletion({
            model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: VOICE_SYSTEM_PROMPT }, { role: 'user', content: `<transcript>\n${n.transcript}\n</transcript>` }],
        }, 30_000);
        try { if (content) llm = JSON.parse(content); } catch { /* fallback till regex-extraktionen */ }
        const fb = n.extracted_data;
        const extracted = {
            person_name: llm?.person_name ?? fb.person_name ?? null,
            company_name: llm?.company_name ?? fb.company_name ?? null,
            industry: llm?.industry ?? fb.industry ?? null,
            email: llm?.email ?? fb.email ?? null,
            pain_points: llm?.pain_points ?? fb.pain_points ?? [],
            pain_points_summary: llm?.pain_points_summary ?? fb.pain_points_summary ?? null,
            current_process: llm?.current_process ?? fb.current_process ?? null,
            meeting_requested: llm?.meeting_requested ?? fb.meeting_requested ?? false,
            language_detected: llm?.language_detected ?? null,
        };
        const summary: string | null = llm?.summary || n.summary || null;

        const { error: vErr } = await db().from('voice_calls').upsert({
            session_uuid: n.session_uuid, prospect_id, customer_id, provider: n.provider, external_call_id: n.external_call_id,
            call_source: n.call_source, agent_id: n.agent_id, started_at: n.started_at, ended_at: n.ended_at, duration_seconds: n.duration_seconds,
            transcript: n.transcript, summary, recording_url: n.recording_url, extracted_data: extracted, metadata: n.metadata, raw_payload: n.raw_payload,
        }, { onConflict: 'provider,external_call_id' });
        if (vErr) throw new Error(`voice_calls upsert: ${vErr.message}`);

        const { error: iErr } = await db().from('interactions').insert({
            session_uuid: n.session_uuid, type: 'voice',
            payload: { external_call_id: n.external_call_id, prospect_id, customer_id, source: n.call_source, summary, transcript: n.transcript, duration_seconds: n.duration_seconds, started_at: n.started_at, ended_at: n.ended_at, extracted_data: extracted },
        });
        if (iErr) logger.warn('site.voice', 'interactions insert failed', { error: iErr.message });

        ingestLead({ source: 'voice_call', session_uuid: n.session_uuid, prospect_id, name: extracted.person_name, email: extracted.email, company: extracted.company_name, summary, extracted })
            .catch(e => logger.error('site.voice', 'ingestLead failed', { error: String(e) }));

        return { code: 200, body: { status: 'ok', external_call_id: n.external_call_id } };
    } catch (e) {
        logger.error('site.voice', 'voice-call-ended failed', { error: String(e) });
        return { code: 500, body: { status: 'error', message: 'internal error' } };
    }
}

// Server-till-server (token). Behålls för ev. extern proxy.
router.post('/voice-call-ended', tokenAuth('SITE_VOICE_WEBHOOK_TOKEN'), async (req: Request, res: Response) => {
    const r = await handleVoiceCallEnded(req.body);
    return res.status(r.code).json(r.body);
});

// ---------------------------------------------------------------------------
// Röst-proxy (ersätter skyland-voice-proxy på Fly). Anropas direkt från
// webbläsaren på skylandai.se. API-nyckeln lämnar aldrig servern.
// ---------------------------------------------------------------------------
const voiceLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { detail: 'rate limited' } });

// POST /voice/signed-url  { session_uuid, agent_id? } → { signed_url }
router.post('/voice/signed-url', voiceLimiter, async (req: Request, res: Response) => {
    const sid = str(req.body?.session_uuid, 64);
    if (!UUID_V4.test(sid)) return res.status(400).json({ detail: 'invalid session uuid' });
    if (!config.ELEVENLABS_API_KEY) { logger.error('site.voice', 'ELEVENLABS_API_KEY saknas'); return res.status(503).json({ detail: 'voice service not configured' }); }
    const agentId = str(req.body?.agent_id, 80) || config.ELEVENLABS_AGENT_ID || '';
    if (!agentId) return res.status(400).json({ detail: 'no agent configured' });
    try {
        const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {
            headers: { 'xi-api-key': config.ELEVENLABS_API_KEY },
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) { logger.error('site.voice', `ElevenLabs signed-url ${r.status}`, { text: (await r.text()).slice(0, 200) }); return res.status(502).json({ detail: 'voice service unavailable' }); }
        const j = await r.json() as { signed_url?: string };
        if (!j.signed_url) return res.status(502).json({ detail: 'voice service unavailable' });
        logger.info('site.voice', 'signed url issued', { session: sid, agent: agentId });
        return res.json({ signed_url: j.signed_url });
    } catch (e) {
        logger.error('site.voice', 'signed-url failed', { error: String(e) });
        return res.status(502).json({ detail: 'voice service unavailable' });
    }
});

// POST /voice/call-ended — från webbläsaren efter avslutat samtal (samma payload som Fly-proxyn tog emot).
router.post('/voice/call-ended', voiceLimiter, async (req: Request, res: Response) => {
    const b = req.body || {};
    const sid = b.session_uuid || b.metadata?.session_uuid || b.metadata?.sessionId || b.raw_payload?.session_uuid || b.raw_payload?.sessionId || null;
    if (sid && !UUID_V4.test(String(sid))) return res.status(400).json({ detail: 'invalid session uuid' });
    const r = await handleVoiceCallEnded({ ...b, session_uuid: sid, source: b.source || 'voice_call_ended' });
    if (r.code !== 200) return res.status(r.code).json(r.body);
    return res.json({ status: 'accepted' });
});

export default router;
