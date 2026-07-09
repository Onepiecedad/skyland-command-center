import { useState, useEffect, useCallback } from 'react';
import {
    CheckCircle,
    AlertTriangle,
    XCircle,
    RefreshCw,
    Clock,
    Zap,
} from 'lucide-react';
import { API_URL } from '../../config';

// ─── Types ───
type WorkflowStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'IDLE';

interface Workflow {
    id: string;
    name: string;
    active: boolean;
    status: WorkflowStatus;
    lastRun: string | null;
    lastRunStatus: string | null;
    nextRun: string | null;
    executionCount: number;
    schedule: string | null;
    lastError: string | null;
    lastSummary: string | null;
}

const STATUS_CONFIG: Record<WorkflowStatus, { icon: typeof CheckCircle; color: string; label: string }> = {
    HEALTHY: { icon: CheckCircle, color: 'var(--accent-green, #34d399)', label: 'Healthy' },
    DEGRADED: { icon: AlertTriangle, color: 'var(--accent-yellow, #fbbf24)', label: 'Degraded' },
    CRITICAL: { icon: XCircle, color: 'var(--accent-red, #f87171)', label: 'Critical' },
    IDLE: { icon: Clock, color: 'var(--text-muted, #64748b)', label: 'Inaktiv' },
};

function timeAgo(iso: string | null): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just nu';
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    return `${Math.floor(hours / 24)}d sedan`;
}

export function WorkflowHealth() {
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [expanded, setExpanded] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<Record<string, string>>({});

    const errText = (d: { error?: unknown }, status: number): string => {
        const e = d?.error;
        if (typeof e === 'string') return e;
        if (e) return JSON.stringify(e);
        return `HTTP ${status}`;
    };

    const runJob = useCallback(async (id: string) => {
        setActionMsg((m) => ({ ...m, [id]: 'Startar…' }));
        try {
            const r = await fetch(`${API_URL}/api/v1/automations/${encodeURIComponent(id)}/run`, { method: 'POST' });
            let d: { ok?: boolean; error?: unknown } = {};
            try { d = await r.json(); } catch { /* non-JSON */ }
            setActionMsg((m) => ({ ...m, [id]: d.ok ? '✓ Startad (kör i bakgrunden)' : `Fel: ${errText(d, r.status)}` }));
        } catch {
            setActionMsg((m) => ({ ...m, [id]: 'Fel: kunde inte nå servern (kör backend?)' }));
        }
    }, []);

    const toggleJob = useCallback(async (id: string, enable: boolean) => {
        setActionMsg((m) => ({ ...m, [id]: enable ? 'Slår på…' : 'Stänger av…' }));
        try {
            const r = await fetch(`${API_URL}/api/v1/automations/${encodeURIComponent(id)}/toggle`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: enable }),
            });
            let d: { ok?: boolean; error?: unknown } = {};
            try { d = await r.json(); } catch { /* non-JSON */ }
            setActionMsg((m) => ({ ...m, [id]: d.ok ? (enable ? '✓ Påslaget' : '✓ Avstängt') : `Fel: ${errText(d, r.status)}` }));
        } catch {
            setActionMsg((m) => ({ ...m, [id]: 'Fel: kunde inte nå servern (kör backend?)' }));
        }
    }, []);

    const fetchWorkflows = useCallback(async () => {
        // Real data: the gateway's scheduled jobs + run history (no more mock).
        try {
            const res = await fetch(`${API_URL}/api/v1/automations`);
            const data = await res.json();
            const jobs: Workflow[] = (data.jobs || []).map((j: {
                id: string; name: string; enabled: boolean; status: WorkflowStatus;
                lastRun: string | null; lastRunStatus: string | null;
                nextRun: string | null; executionCount: number;
                schedule: string | null; lastError: string | null; lastSummary: string | null;
            }) => ({
                id: j.id,
                name: j.name,
                active: j.enabled,
                status: j.status,
                lastRun: j.lastRun,
                lastRunStatus: j.lastRunStatus,
                nextRun: j.nextRun,
                executionCount: j.executionCount,
                schedule: j.schedule,
                lastError: j.lastError,
                lastSummary: j.lastSummary,
            }));
            setWorkflows(jobs);
        } catch {
            setWorkflows([]);
        }
        setLoading(false);
        setLastRefresh(new Date());
    }, []);

    useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

    // Auto-refresh every 30s
    useEffect(() => {
        const interval = setInterval(fetchWorkflows, 30000);
        return () => clearInterval(interval);
    }, [fetchWorkflows]);

    const healthyCount = workflows.filter(w => w.status === 'HEALTHY').length;
    const degradedCount = workflows.filter(w => w.status === 'DEGRADED').length;
    const criticalCount = workflows.filter(w => w.status === 'CRITICAL').length;

    return (
        <div className="sys-panel sys-workflow-health">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <Zap size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Schemalagda jobb</h3>
                </div>
                <button
                    className="sys-refresh-btn"
                    onClick={fetchWorkflows}
                    title="Uppdatera"
                >
                    <RefreshCw size={13} className={loading ? 'sys-spin' : ''} />
                </button>
            </div>

            {/* Summary pills */}
            <div className="sys-wf-summary">
                <span className="sys-wf-pill sys-pill-healthy">{healthyCount} Healthy</span>
                {degradedCount > 0 && <span className="sys-wf-pill sys-pill-degraded">{degradedCount} Degraded</span>}
                {criticalCount > 0 && <span className="sys-wf-pill sys-pill-critical">{criticalCount} Critical</span>}
            </div>

            {/* Workflow rows */}
            <div className="sys-wf-list">
                {!loading && workflows.length === 0 && (
                    <div style={{ opacity: 0.6, fontSize: 13, padding: 12 }}>
                        Inga schemalagda jobb hittades i gatewayns databas.
                    </div>
                )}
                {workflows.map(wf => {
                    const conf = STATUS_CONFIG[wf.status];
                    const Icon = conf.icon;
                    const isOpen = expanded === wf.id;
                    return (
                        <div key={wf.id}>
                            <button
                                onClick={() => setExpanded(isOpen ? null : wf.id)}
                                className={`sys-wf-row sys-wf-${wf.status.toLowerCase()}`}
                                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: isOpen ? 'rgba(255,255,255,0.05)' : undefined, border: 'none', color: 'inherit' }}
                            >
                                <div className="sys-wf-status-icon">
                                    <Icon size={14} style={{ color: conf.color }} />
                                </div>
                                <div className="sys-wf-info">
                                    <span className="sys-wf-name">{wf.name}</span>
                                    <span className="sys-wf-meta">
                                        <Clock size={10} />
                                        {timeAgo(wf.lastRun)}
                                        {!wf.active && <span className="sys-wf-inactive">Inaktiv</span>}
                                    </span>
                                </div>
                                <div className="sys-wf-runs">{wf.executionCount} runs</div>
                            </button>
                            {isOpen && (
                                <div style={{ padding: '8px 12px 12px 34px', fontSize: 12, lineHeight: 1.5 }}>
                                    <div style={{ opacity: 0.7 }}>
                                        Schema: <code style={{ opacity: 0.9 }}>{wf.schedule || '—'}</code>
                                        {wf.nextRun && <> · Nästa: {new Date(wf.nextRun).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</>}
                                        {' · '}Senaste status: <strong style={{ color: conf.color }}>{wf.lastRunStatus || '—'}</strong>
                                    </div>
                                    {wf.lastError && (
                                        <div style={{ marginTop: 6, color: '#fca5a5' }}>
                                            ⚠ Fel: {wf.lastError}
                                        </div>
                                    )}
                                    {wf.lastSummary && (
                                        <div style={{ marginTop: 6, opacity: 0.75, whiteSpace: 'pre-wrap' }}>
                                            {wf.lastSummary.slice(0, 400)}{wf.lastSummary.length > 400 ? '…' : ''}
                                        </div>
                                    )}
                                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <button
                                            onClick={() => { if (window.confirm(`Kör "${wf.name}" nu?`)) runJob(wf.id); }}
                                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                                                border: '1px solid rgba(52,211,153,0.5)', background: 'rgba(52,211,153,0.15)', color: 'inherit' }}>
                                            ▶ Kör nu
                                        </button>
                                        <button
                                            onClick={() => toggleJob(wf.id, !wf.active)}
                                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                                                border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'inherit' }}>
                                            {wf.active ? '⏸ Stäng av' : '▶ Slå på'}
                                        </button>
                                        {actionMsg[wf.id] && (
                                            <span style={{ fontSize: 11, opacity: 0.8 }}>{actionMsg[wf.id]}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="sys-panel-footer">
                <span className="sys-footer-text">Senast uppdaterad {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        </div>
    );
}
