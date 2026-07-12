import { Router, Request, Response } from 'express';
import { websiteSupabase } from '../services/supabase';

/**
 * Website analytics — aggregates the anonymous telemetry from
 * skyland-ai-os.netlify.app (events table in the website Supabase project)
 * together with prospects/voice_calls, plus n8n workflow health.
 *
 * Mounted behind the global auth middleware.
 */

const router = Router();

interface EventRow {
    session_uuid: string;
    type: string;
    data: Record<string, unknown>;
    created_at: string;
}

function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ============================================================================
// GET /stats?days=7 — KPIs, funnel, ROI signals, language split, daily series
// ============================================================================

router.get('/stats', async (req: Request, res: Response) => {
    if (!websiteSupabase) {
        return res.status(503).json({ error: 'WEBSITE_SUPABASE_URL not configured' });
    }
    try {
        const days = Math.min(Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1), 90);
        const since = daysAgoIso(days);

        const [eventsRes, prospectsRes, callsRes] = await Promise.all([
            websiteSupabase
                .from('events')
                .select('session_uuid, type, data, created_at')
                .gte('created_at', since)
                .order('created_at', { ascending: true })
                .limit(10000),
            websiteSupabase
                .from('prospects')
                .select('id, session_uuid, created_at')
                .gte('created_at', since),
            websiteSupabase
                .from('voice_calls')
                .select('id, session_uuid, duration_seconds, created_at')
                .gte('created_at', since),
        ]);

        const events = (eventsRes.data || []) as EventRow[];
        const prospects = prospectsRes.data || [];
        const calls = callsRes.data || [];

        // Aggregate
        const sessions = new Set<string>();
        const engaged = new Set<string>();
        const leads = new Set<string>();
        const bookingClicks = new Set<string>();
        const counts: Record<string, number> = {};
        const langSplit: Record<string, number> = {};
        const daily: Record<string, Set<string>> = {};
        const roiBySession: Record<string, { hours: number; rate: number; at: string }> = {};

        const ENGAGE_TYPES = new Set(['video_play', 'starter_click', 'form_start', 'voice_start', 'roi_input']);
        const LEAD_TYPES = new Set(['form_submit', 'voice_end']);

        for (const ev of events) {
            sessions.add(ev.session_uuid);
            counts[ev.type] = (counts[ev.type] || 0) + 1;
            if (ENGAGE_TYPES.has(ev.type)) engaged.add(ev.session_uuid);
            if (LEAD_TYPES.has(ev.type)) leads.add(ev.session_uuid);
            if (ev.type === 'cta_book_click') bookingClicks.add(ev.session_uuid);
            if (ev.type === 'lang' && typeof ev.data?.lang === 'string') {
                langSplit[ev.data.lang as string] = (langSplit[ev.data.lang as string] || 0) + 1;
            }
            if (ev.type === 'roi_input') {
                const hours = Number(ev.data?.hours);
                const rate = Number(ev.data?.rate);
                if (Number.isFinite(hours) && Number.isFinite(rate)) {
                    roiBySession[ev.session_uuid] = { hours, rate, at: ev.created_at };
                }
            }
            const day = ev.created_at.slice(0, 10);
            if (!daily[day]) daily[day] = new Set();
            daily[day].add(ev.session_uuid);
        }

        // Reconcile the funnel with server-side truth. The client-side events
        // table (voice_start/voice_end/cta_book_click) is frequently missing —
        // e.g. a voice call that produced a prospect but never fired browser
        // telemetry. Without this, the funnel shows false zeros while the KPI
        // cards (which read prospects/voice_calls directly) show real numbers.
        // A session that reached a prospect or a voice call is, by definition,
        // engaged and a lead — so fold those sessions in. Sets dedupe, so this
        // never double-counts a session already counted from an event.
        for (const call of calls) {
            const sid = (call as { session_uuid?: string }).session_uuid;
            if (sid) {
                sessions.add(sid);
                engaged.add(sid);
            }
        }
        for (const prospect of prospects) {
            const sid = (prospect as { session_uuid?: string }).session_uuid;
            if (sid) {
                sessions.add(sid);
                engaged.add(sid);
                leads.add(sid);
            }
        }

        const avgCallSeconds = calls.length
            ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / calls.length)
            : 0;

        return res.json({
            days,
            kpis: {
                sessions: sessions.size,
                engaged: engaged.size,
                leads: prospects.length,
                voice_calls: calls.length,
                avg_call_seconds: avgCallSeconds,
                booking_clicks: bookingClicks.size,
                conversion_pct: sessions.size ? Math.min(Math.round((prospects.length / sessions.size) * 100), 100) : 0,
            },
            funnel: {
                sessions: sessions.size,
                engaged: engaged.size,
                leads: leads.size,
                booking_clicks: bookingClicks.size,
            },
            event_counts: counts,
            lang_split: langSplit,
            roi_signals: Object.entries(roiBySession)
                .map(([session_uuid, v]) => ({ session_uuid, ...v }))
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 20),
            daily_sessions: Object.entries(daily)
                .map(([day, set]) => ({ day, sessions: set.size }))
                .sort((a, b) => a.day.localeCompare(b.day)),
        });
    } catch (err) {
        console.error('[Website Stats] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /sessions?limit=25 — recent sessions with full event chains + lead match
// ============================================================================

router.get('/sessions', async (req: Request, res: Response) => {
    if (!websiteSupabase) {
        return res.status(503).json({ error: 'WEBSITE_SUPABASE_URL not configured' });
    }
    try {
        const limit = Math.min(parseInt(String(req.query.limit || '25'), 10) || 25, 100);

        const { data: recent, error } = await websiteSupabase
            .from('events')
            .select('session_uuid, type, data, created_at')
            .order('created_at', { ascending: false })
            .limit(1500);

        if (error) return res.status(500).json({ error: error.message });

        // Group by session, keep the N most recently active
        const bySession = new Map<string, EventRow[]>();
        for (const ev of (recent || []) as EventRow[]) {
            if (!bySession.has(ev.session_uuid)) {
                if (bySession.size >= limit) continue;
                bySession.set(ev.session_uuid, []);
            }
            bySession.get(ev.session_uuid)!.push(ev);
        }

        const uuids = [...bySession.keys()];
        const { data: prospects } = uuids.length
            ? await websiteSupabase
                .from('prospects')
                .select('session_uuid, name, company, score')
                .in('session_uuid', uuids)
            : { data: [] };

        const prospectMap = new Map(
            (prospects || []).map((p) => [p.session_uuid, p])
        );

        const sessions = [...bySession.entries()].map(([uuid, evs]) => {
            const sorted = evs.sort((a, b) => a.created_at.localeCompare(b.created_at));
            return {
                session_uuid: uuid,
                first_seen: sorted[0].created_at,
                last_seen: sorted[sorted.length - 1].created_at,
                prospect: prospectMap.get(uuid) || null,
                events: sorted.map((e) => ({ type: e.type, data: e.data, at: e.created_at })),
            };
        }).sort((a, b) => b.last_seen.localeCompare(a.last_seen));

        return res.json({ sessions });
    } catch (err) {
        console.error('[Website Sessions] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /workflows — n8n workflow health (last executions per workflow)
// ============================================================================

router.get('/workflows', async (_req: Request, res: Response) => {
    const apiUrl = process.env.N8N_API_URL;
    const apiKey = process.env.N8N_API_KEY;
    if (!apiUrl || !apiKey) {
        return res.status(503).json({ error: 'N8N_API_URL/N8N_API_KEY not configured' });
    }
    try {
        const [execRes, wfRes] = await Promise.all([
            fetch(`${apiUrl}/executions?limit=100`, { headers: { 'X-N8N-API-KEY': apiKey } }),
            fetch(`${apiUrl}/workflows`, { headers: { 'X-N8N-API-KEY': apiKey } }),
        ]);
        if (!execRes.ok) return res.status(502).json({ error: `n8n HTTP ${execRes.status}` });
        const body = await execRes.json() as { data?: Array<{ workflowId: string; status: string; startedAt: string }> };
        const wfBody = wfRes.ok
            ? await wfRes.json() as { data?: Array<{ id: string; name: string }> }
            : { data: [] };
        const nameById = new Map((wfBody.data || []).map((w) => [w.id, w.name]));

        const byWorkflow: Record<string, { name: string; total: number; errors: number; last_status: string; last_run: string }> = {};
        for (const ex of body.data || []) {
            const name = nameById.get(ex.workflowId) || ex.workflowId;
            if (!byWorkflow[name]) {
                byWorkflow[name] = { name, total: 0, errors: 0, last_status: ex.status, last_run: ex.startedAt };
            }
            byWorkflow[name].total++;
            if (ex.status === 'error' || ex.status === 'failed' || ex.status === 'crashed') byWorkflow[name].errors++;
        }

        return res.json({ workflows: Object.values(byWorkflow) });
    } catch (err) {
        console.error('[Website Workflows] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
