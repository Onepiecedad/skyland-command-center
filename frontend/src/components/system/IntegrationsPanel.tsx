/**
 * Integrations-hälsa (SCC-37) — visar status per extern integration i System-fliken.
 * Motverkar GHL:s vanligaste driftsvikt: integrationer som dör tyst.
 */
import { useState, useEffect, useCallback } from 'react';
import { Plug, CheckCircle, XCircle, KeyRound, CircleSlash, RefreshCw } from 'lucide-react';
import { fetchIntegrationsHealth } from '../../api/system';
import type { IntegrationHealth, IntegrationStatus } from '../../api/system';

const STATUS_CONFIG: Record<IntegrationStatus, { icon: typeof CheckCircle; color: string; label: string }> = {
    up: { icon: CheckCircle, color: 'var(--accent-green, #34d399)', label: 'Uppe' },
    down: { icon: XCircle, color: 'var(--accent-red, #f87171)', label: 'Nere' },
    auth_failed: { icon: KeyRound, color: 'var(--accent-yellow, #fbbf24)', label: 'Auth-fel' },
    not_configured: { icon: CircleSlash, color: 'var(--text-muted, #64748b)', label: 'Ej konfigurerad' },
};

function timeAgo(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just nu';
    if (mins < 60) return `${mins}m sedan`;
    return `${Math.floor(mins / 60)}h sedan`;
}

export function IntegrationsPanel() {
    const [integrations, setIntegrations] = useState<IntegrationHealth[]>([]);
    const [overall, setOverall] = useState<'healthy' | 'degraded' | null>(null);
    const [checkedAt, setCheckedAt] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchIntegrationsHealth();
            setIntegrations(data.integrations);
            setOverall(data.overall);
            setCheckedAt(data.checked_at);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Kunde inte nå servern');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="sys-panel">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <Plug size={15} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Integrationer</h3>
                    {overall && (
                        <span
                            style={{
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 8,
                                color: overall === 'healthy' ? 'var(--accent-green, #34d399)' : 'var(--accent-yellow, #fbbf24)',
                                background: overall === 'healthy' ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)',
                            }}
                        >
                            {overall === 'healthy' ? 'Friskt' : 'Degraderat'}
                        </span>
                    )}
                </div>
                <button className="sys-refresh-btn" onClick={load} title="Uppdatera" disabled={loading}>
                    <RefreshCw size={13} className={loading ? 'sys-spin' : undefined} />
                </button>
            </div>

            {error && (
                <div style={{ fontSize: '0.75rem', color: 'var(--accent-red, #f87171)' }}>{error}</div>
            )}

            {!error && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {integrations.map((i) => {
                        const cfg = STATUS_CONFIG[i.status];
                        const Icon = cfg.icon;
                        return (
                            <div
                                key={i.name}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.4rem 0.55rem',
                                    borderRadius: 10,
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.05)',
                                }}
                            >
                                <Icon size={14} style={{ color: cfg.color, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.78rem', color: '#fff', fontWeight: 500, textTransform: 'capitalize' }}>
                                    {i.name}
                                </span>
                                <span style={{ fontSize: '0.68rem', color: cfg.color }}>{cfg.label}</span>
                                {i.detail && (
                                    <span
                                        style={{
                                            fontSize: '0.65rem',
                                            color: 'rgba(255,255,255,0.35)',
                                            marginLeft: 'auto',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            maxWidth: 180,
                                        }}
                                        title={i.detail}
                                    >
                                        {i.detail}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                    {!loading && integrations.length === 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)' }}>
                            Inga integrationer rapporterade (INTEGRATION_HEALTH_ENABLED?)
                        </div>
                    )}
                </div>
            )}

            <div className="sys-panel-footer">
                <span className="sys-footer-text">
                    {checkedAt ? `Senast kollad ${timeAgo(checkedAt)}` : 'Probar Supabase · Resend · Cal.com · 46elks · OpenRouter'}
                </span>
            </div>
        </div>
    );
}
