import { useEffect, useState, useCallback } from 'react';
import { fetchLeads, type Lead } from '../api';
import LeadDetailModal from '../components/LeadDetailModal';

/**
 * LeadsView — inkommande leads från skylandai.se (formulär + röstsamtal).
 * Data kommer via n8n → POST /api/v1/leads/intake och lagras som
 * activities med event_type='lead'. Auto-uppdateras var 15:e sekund.
 */
export default function LeadsView() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await fetchLeads(100);
            setLeads(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte hämta leads');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void load();
        const interval = setInterval(() => void load(), 15000);
        return () => clearInterval(interval);
    }, [load]);

    const sourceLabel = (s?: string): string =>
        s === 'voice_call' ? '🎙️ Röstsamtal' : s === 'void_form' ? '📝 Formulär' : '🎯 Lead';

    const timeAgo = (iso: string): string => {
        const diff = Date.now() - new Date(iso).getTime();
        const min = Math.floor(diff / 60000);
        if (min < 1) return 'nyss';
        if (min < 60) return `${min} min sedan`;
        const h = Math.floor(min / 60);
        if (h < 24) return `${h} h sedan`;
        return new Date(iso).toLocaleDateString('sv-SE');
    };

    return (
        <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>🎯 Leads</h1>
                <span style={{ opacity: 0.6, fontSize: 14 }}>
                    {leads.length} inkomna · uppdateras automatiskt
                </span>
            </div>

            {loading && <p style={{ opacity: 0.6 }}>Laddar leads…</p>}
            {error && <p style={{ color: '#ff6b6b' }}>Fel: {error}</p>}
            {!loading && !error && leads.length === 0 && (
                <p style={{ opacity: 0.6 }}>
                    Inga leads än. När någon fyller i formuläret eller pratar med röstagenten på
                    skylandai.se dyker de upp här.
                </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {leads.map(lead => {
                    const d = lead.details || {};
                    return (
                        <div
                            key={lead.id}
                            onClick={() => setSelectedLead(lead)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedLead(lead); }}
                            role="button"
                            tabIndex={0}
                            title="Klicka för detaljer"
                            style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 14,
                                padding: '16px 20px',
                                backdropFilter: 'blur(12px)',
                                cursor: 'pointer',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <strong style={{ fontSize: 16 }}>{d.name || 'Okänd besökare'}</strong>
                                    <span style={{ fontSize: 12, opacity: 0.7 }}>{sourceLabel(d.source)}</span>
                                    {typeof d.score === 'number' && (
                                        <span style={{
                                            fontSize: 12, padding: '2px 8px', borderRadius: 8,
                                            background: d.score >= 40 ? 'rgba(80,220,120,0.18)' : 'rgba(255,255,255,0.08)',
                                        }}>
                                            score {d.score}
                                        </span>
                                    )}
                                </div>
                                <span style={{ fontSize: 12, opacity: 0.5 }}>{timeAgo(lead.created_at)}</span>
                            </div>
                            <div style={{ fontSize: 13, opacity: 0.85, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                                {d.company && <span>🏢 {d.company}</span>}
                                {d.email && <span>✉️ {d.email}</span>}
                                {d.phone && <span>📞 {d.phone}</span>}
                                {d.website && <span>🌐 {d.website}</span>}
                            </div>
                            {(d.message || d.summary) && (
                                <p style={{ fontSize: 13, opacity: 0.7, marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
                                    {d.message || d.summary}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>

            {selectedLead && (
                <LeadDetailModal
                    lead={selectedLead}
                    onClose={() => setSelectedLead(null)}
                    onChanged={() => void load()}
                />
            )}
        </div>
    );
}
