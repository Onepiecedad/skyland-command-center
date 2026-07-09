import { useEffect, useState } from 'react';
import { fetchLeadDetail, type Lead, type LeadDetail } from '../api';

interface LeadDetailModalProps {
    lead: Lead;
    onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 24,
};

const cardStyle: React.CSSProperties = {
    background: 'rgba(18,22,34,0.97)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 18,
    width: 'min(720px, 100%)',
    maxHeight: '85vh',
    overflowY: 'auto',
    padding: '28px 32px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
};

const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    opacity: 0.5,
    margin: '20px 0 8px',
};

const preStyle: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 13,
    lineHeight: 1.6,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '12px 14px',
    margin: 0,
    fontFamily: 'inherit',
};

function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('sv-SE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

function formatDuration(seconds: number | null | undefined): string {
    if (!seconds && seconds !== 0) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

/**
 * LeadDetailModal — popup med all information om ett lead:
 * kontaktuppgifter, datum/tid, meddelande, AI-svar, samtalstranskribering
 * och extraherad data. Data hämtas från /leads/:id/detail som joinar
 * hemsidans Supabase (prospects, interactions, voice_calls).
 */
export default function LeadDetailModal({ lead, onClose }: LeadDetailModalProps) {
    const [detail, setDetail] = useState<LeadDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchLeadDetail(lead.id)
            .then((d) => { if (!cancelled) setDetail(d); })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Kunde inte hämta detaljer');
            });
        return () => { cancelled = true; };
    }, [lead.id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const d = lead.details || {};
    const isVoice = d.source === 'voice_call';
    const aiResponses = (detail?.interactions || []).filter((i) => i.payload?.ai_response);
    const voiceCalls = detail?.voice_calls || [];
    const extracted = (d.extracted && Object.keys(d.extracted).length > 0 ? d.extracted : null)
        || voiceCalls.find((v) => v.extracted_data && Object.keys(v.extracted_data).length > 0)?.extracted_data
        || null;

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
                            {d.name || 'Okänd besökare'}
                        </h2>
                        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
                            {isVoice ? '🎙️ Röstsamtal' : '📝 Formulär'} · {formatDateTime(lead.created_at)}
                            {typeof d.score === 'number' && ` · score ${d.score}`}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Stäng"
                        style={{
                            background: 'rgba(255,255,255,0.08)', border: 'none', color: 'inherit',
                            borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer',
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Kontaktuppgifter */}
                <div style={sectionTitleStyle}>Kontakt</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
                    <span>🏢 {d.company || '—'}</span>
                    <span>✉️ {d.email ? <a href={`mailto:${d.email}`} style={{ color: '#7fd4a8' }}>{d.email}</a> : '—'}</span>
                    <span>📞 {d.phone ? <a href={`tel:${d.phone}`} style={{ color: '#7fd4a8' }}>{d.phone}</a> : '—'}</span>
                    <span>🌐 {d.website || '—'}</span>
                </div>

                {/* Meddelande (formulär) */}
                {d.message && (
                    <>
                        <div style={sectionTitleStyle}>Meddelande</div>
                        <pre style={preStyle}>{d.message}</pre>
                    </>
                )}

                {/* Sammanfattning (röst) */}
                {d.summary && (
                    <>
                        <div style={sectionTitleStyle}>Sammanfattning</div>
                        <pre style={preStyle}>{d.summary}</pre>
                    </>
                )}

                {/* Laddning / fel för fördjupad data */}
                {!detail && !error && (
                    <p style={{ fontSize: 13, opacity: 0.5, marginTop: 20 }}>Hämtar detaljer…</p>
                )}
                {error && (
                    <p style={{ fontSize: 13, color: '#ff6b6b', marginTop: 20 }}>Fel: {error}</p>
                )}

                {/* AI-svar */}
                {aiResponses.map((i) => (
                    <div key={i.id}>
                        <div style={sectionTitleStyle}>
                            ✨ AI-svar · {formatDateTime(i.created_at)}
                        </div>
                        <pre style={preStyle}>{i.payload.ai_response}</pre>
                    </div>
                ))}

                {/* Samtalstranskribering */}
                {voiceCalls.map((v) => (
                    <div key={v.id}>
                        <div style={sectionTitleStyle}>
                            🎙️ Samtal · {formatDateTime(v.started_at)} · {formatDuration(v.duration_seconds)}
                        </div>
                        {v.summary && !d.summary && <pre style={{ ...preStyle, marginBottom: 8 }}>{v.summary}</pre>}
                        {v.transcript
                            ? <pre style={preStyle}>{v.transcript}</pre>
                            : <p style={{ fontSize: 13, opacity: 0.5 }}>Ingen transkribering sparad.</p>}
                        {v.recording_url && (
                            <a href={v.recording_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#7fd4a8' }}>
                                ▶ Lyssna på inspelning
                            </a>
                        )}
                    </div>
                ))}

                {/* Extraherad data (röst-leads) */}
                {extracted && (
                    <>
                        <div style={sectionTitleStyle}>Extraherad data</div>
                        <pre style={preStyle}>{JSON.stringify(extracted, null, 2)}</pre>
                    </>
                )}

                {detail && !detail.website_data_available && (
                    <p style={{ fontSize: 12, opacity: 0.45, marginTop: 16 }}>
                        Fördjupad data (transkribering, AI-svar) är inte tillgänglig —
                        WEBSITE_SUPABASE_URL saknas i backend.
                    </p>
                )}

                {/* Metadata */}
                <div style={sectionTitleStyle}>Metadata</div>
                <div style={{ fontSize: 12, opacity: 0.55, lineHeight: 1.7 }}>
                    Session: <code>{d.session_uuid || '—'}</code><br />
                    Prospect-ID: <code>{d.prospect_id || detail?.prospect?.id || '—'}</code><br />
                    Mottaget: {formatDateTime(lead.created_at)}
                </div>
            </div>
        </div>
    );
}
