import { useCallback, useEffect, useState } from 'react';
import {
    fetchWebsiteStats,
    fetchWebsiteSessions,
    fetchWebsiteWorkflows,
    type WebsiteStats,
    type WebsiteSession,
    type WorkflowHealth,
} from '../api';

/**
 * WebsiteView — allt som händer på skyland-ai-os.netlify.app.
 * KPI:er, konverteringstratt, ROI-signaler, språk, sessionskedjor
 * och n8n-workflowhälsa. Auto-uppdateras var 30:e sekund.
 */

const EVENT_LABELS: Record<string, string> = {
    page_view: 'Sidvisning',
    lang: 'Språk',
    video_play: 'Video startad',
    video_complete: 'Video sedd klart',
    starter_click: 'Starter-klick',
    voice_start: 'Röstsamtal startat',
    voice_end: 'Röstsamtal avslutat',
    voice_error: 'Röstfel',
    form_start: 'Formulär påbörjat',
    form_submit: 'Formulär skickat',
    form_error: 'Formulärfel',
    roi_input: 'ROI-kalkyl',
    cta_book_click: 'Bokningsklick',
};

const EVENT_ICONS: Record<string, string> = {
    page_view: '👁', video_play: '▶️', video_complete: '✅', starter_click: '💬',
    voice_start: '🎙', voice_end: '🎙', voice_error: '⚠️',
    form_start: '✏️', form_submit: '📨', form_error: '⚠️',
    roi_input: '🧮', cta_book_click: '📅', lang: '🌐',
};

const cardStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: '16px 20px',
};

function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function eventSummary(ev: { type: string; data: Record<string, unknown> }): string {
    const label = EVENT_LABELS[ev.type] || ev.type;
    if (ev.type === 'page_view') return `${label}: ${ev.data.module || '?'}`;
    if (ev.type === 'starter_click') return `${label}: "${ev.data.starter || ''}"`;
    if (ev.type === 'roi_input') return `${label}: ${ev.data.hours} h/v × ${ev.data.rate} kr`;
    if (ev.type === 'lang') return `${label}: ${String(ev.data.lang || '').toUpperCase()}`;
    if (ev.type === 'video_play' || ev.type === 'video_complete') return `${label} (${ev.data.video || ''})`;
    return label;
}

export default function WebsiteView() {
    const [stats, setStats] = useState<WebsiteStats | null>(null);
    const [sessions, setSessions] = useState<WebsiteSession[]>([]);
    const [workflows, setWorkflows] = useState<WorkflowHealth[]>([]);
    const [days, setDays] = useState(7);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [s, sess, wf] = await Promise.all([
                fetchWebsiteStats(days),
                fetchWebsiteSessions(30),
                fetchWebsiteWorkflows().catch(() => [] as WorkflowHealth[]),
            ]);
            setStats(s);
            setSessions(sess);
            setWorkflows(wf);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte hämta data');
        }
    }, [days]);

    useEffect(() => {
        void load();
        const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
        return () => clearInterval(t);
    }, [load]);

    const kpis = stats ? [
        { label: 'Sessioner', value: stats.kpis.sessions },
        { label: 'Engagerade', value: stats.kpis.engaged },
        { label: 'Leads', value: stats.kpis.leads },
        { label: 'Konvertering', value: `${stats.kpis.conversion_pct}%` },
        { label: 'Röstsamtal', value: stats.kpis.voice_calls, sub: stats.kpis.avg_call_seconds ? `⌀ ${Math.round(stats.kpis.avg_call_seconds / 60 * 10) / 10} min` : undefined },
        { label: 'Boknings-klick', value: stats.kpis.booking_clicks },
    ] : [];

    const funnelMax = stats ? Math.max(stats.funnel.sessions, 1) : 1;
    const funnelSteps = stats ? [
        { label: 'Besök', value: stats.funnel.sessions },
        { label: 'Engagemang', value: stats.funnel.engaged },
        { label: 'Lead-händelse', value: stats.funnel.leads },
        { label: 'Bokningsklick', value: stats.funnel.booking_clicks },
    ] : [];

    return (
        <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>🌐 Hemsida</h1>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {[7, 30].map((d) => (
                        <button
                            key={d}
                            onClick={() => setDays(d)}
                            style={{
                                background: days === d ? 'rgba(80,220,120,0.18)' : 'rgba(255,255,255,0.06)',
                                border: `1px solid ${days === d ? 'rgba(80,220,120,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                color: 'inherit', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                            }}
                        >
                            {d} dagar
                        </button>
                    ))}
                    <span style={{ opacity: 0.5, fontSize: 12 }}>uppdateras var 30 s</span>
                </div>
            </div>

            {error && <p style={{ color: '#ff6b6b' }}>Fel: {error}</p>}
            {!stats && !error && <p style={{ opacity: 0.6 }}>Laddar…</p>}

            {stats && (
                <>
                    {/* KPI-rad */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
                        {kpis.map((k) => (
                            <div key={k.label} style={{ ...cardStyle, textAlign: 'center', padding: '14px 8px' }}>
                                <div style={{ fontSize: 26, fontWeight: 800 }}>{k.value}</div>
                                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{k.label}</div>
                                {k.sub && <div style={{ fontSize: 10, opacity: 0.45 }}>{k.sub}</div>}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 16 }}>
                        {/* Tratt */}
                        <div style={cardStyle}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.5, marginBottom: 12 }}>
                                Konverteringstratt · {stats.days} dagar
                            </div>
                            {funnelSteps.map((step) => (
                                <div key={step.label} style={{ marginBottom: 10 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                        <span>{step.label}</span>
                                        <span style={{ opacity: 0.7 }}>{step.value}</span>
                                    </div>
                                    <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${Math.max((step.value / funnelMax) * 100, step.value > 0 ? 3 : 0)}%`,
                                            background: 'linear-gradient(90deg, rgba(80,220,120,0.9), rgba(80,220,120,0.5))',
                                            borderRadius: 4,
                                            transition: 'width .4s ease',
                                        }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ROI-signaler + språk */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ ...cardStyle, flex: 1 }}>
                                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.5, marginBottom: 10 }}>
                                    🧮 ROI-signaler — besökarnas egna siffror
                                </div>
                                {stats.roi_signals.length === 0 && <p style={{ fontSize: 12, opacity: 0.5, margin: 0 }}>Inga än.</p>}
                                {stats.roi_signals.slice(0, 5).map((r) => (
                                    <div key={r.session_uuid + r.at} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <span>{r.hours} h/v × {r.rate} kr</span>
                                        <span style={{ color: '#7fd4a8', fontWeight: 600 }}>
                                            ≈ {(r.hours * r.rate * 52).toLocaleString('sv-SE')} kr/år
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div style={cardStyle}>
                                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.5, marginBottom: 8 }}>Språk</div>
                                <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                                    {Object.entries(stats.lang_split).map(([lang, n]) => (
                                        <span key={lang}>{lang.toUpperCase()}: <strong>{n}</strong></span>
                                    ))}
                                    {Object.keys(stats.lang_split).length === 0 && <span style={{ opacity: 0.5 }}>—</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Workflow-hälsa */}
                    {workflows.length > 0 && (
                        <div style={{ ...cardStyle, marginBottom: 16 }}>
                            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.5, marginBottom: 10 }}>
                                n8n Workflow-hälsa (senaste 100 körningarna)
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                {workflows.map((w) => (
                                    <div key={w.name} style={{
                                        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                                        padding: '6px 12px', borderRadius: 8,
                                        background: w.errors > 0 ? 'rgba(255,107,107,0.12)' : 'rgba(80,220,120,0.1)',
                                        border: `1px solid ${w.errors > 0 ? 'rgba(255,107,107,0.4)' : 'rgba(80,220,120,0.3)'}`,
                                    }}>
                                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: w.errors > 0 ? '#ff6b6b' : '#50dc78' }} />
                                        <strong>{w.name}</strong>
                                        <span style={{ opacity: 0.6 }}>{w.total - w.errors}/{w.total} OK</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Sessioner */}
            <div style={cardStyle}>
                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.5, marginBottom: 12 }}>
                    Senaste sessioner — klicka för händelsekedja
                </div>
                {sessions.length === 0 && <p style={{ fontSize: 12, opacity: 0.5 }}>Inga sessioner än.</p>}
                {sessions.map((s) => {
                    const isOpen = expanded === s.session_uuid;
                    const highlights = s.events.filter((e) => ['form_submit', 'voice_start', 'cta_book_click', 'video_play'].includes(e.type));
                    return (
                        <div key={s.session_uuid} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <div
                                onClick={() => setExpanded(isOpen ? null : s.session_uuid)}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', cursor: 'pointer' }}
                            >
                                <span style={{ fontSize: 12, opacity: 0.5, width: 100, flexShrink: 0 }}>{fmtTime(s.last_seen)}</span>
                                <strong style={{ fontSize: 13, width: 160, flexShrink: 0 }}>
                                    {s.prospect?.name || `Anonym ${s.session_uuid.slice(0, 8)}`}
                                </strong>
                                {s.prospect?.company && <span style={{ fontSize: 12, opacity: 0.7 }}>{s.prospect.company}</span>}
                                <span style={{ fontSize: 12, opacity: 0.55, marginLeft: 'auto' }}>
                                    {s.events.length} händelser {highlights.map((h) => EVENT_ICONS[h.type]).join(' ')}
                                </span>
                                <span style={{ opacity: 0.4 }}>{isOpen ? '▾' : '▸'}</span>
                            </div>
                            {isOpen && (
                                <div style={{ padding: '4px 4px 12px 116px' }}>
                                    {s.events.map((ev, i) => (
                                        <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '3px 0', opacity: 0.85 }}>
                                            <span style={{ opacity: 0.5, width: 42, flexShrink: 0 }}>
                                                {new Date(ev.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            <span>{EVENT_ICONS[ev.type] || '·'}</span>
                                            <span>{eventSummary(ev)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
