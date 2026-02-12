import { useState, useEffect, useCallback } from 'react';
import {
    ShieldAlert,
    RefreshCw,
    RotateCcw,
    AlertTriangle,
    XCircle,
    Info,
} from 'lucide-react';
import { fetchErrorPatterns, retryFailedRun } from '../../api/system';
import type { ErrorPattern } from '../../api/types';

// ─── Helpers ───

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just nu';
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    return `${Math.floor(hours / 24)}d sedan`;
}

function severityColor(cls: string): string {
    switch (cls) {
        case 'dependency': return 'var(--accent-red, #f87171)';
        case 'config': return 'var(--accent-yellow, #fbbf24)';
        case 'transient': return 'var(--accent-blue, #60a5fa)';
        default: return 'var(--text-secondary, #94a3b8)';
    }
}

// ─── Component ───

export function ErrorRecoveryPanel() {
    const [patterns, setPatterns] = useState<ErrorPattern[]>([]);
    const [totalErrors, setTotalErrors] = useState(0);
    const [period, setPeriod] = useState('7d');
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState<string | null>(null);

    const loadErrors = useCallback(async () => {
        try {
            setLoading(true);
            const data = await fetchErrorPatterns();
            setPatterns(data.patterns);
            setTotalErrors(data.total_errors);
            setPeriod(data.period);
        } catch {
            // Silent fail
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadErrors(); }, [loadErrors]);

    // Auto-refresh every 60s
    useEffect(() => {
        const interval = setInterval(loadErrors, 60000);
        return () => clearInterval(interval);
    }, [loadErrors]);

    const handleRetry = async (pattern: ErrorPattern) => {
        if (!pattern.classification?.suggested_action) return;
        try {
            setRetrying(pattern.agent);
            // Try to retry the latest failed task for this agent
            await retryFailedRun(pattern.agent);
            await loadErrors();
        } catch {
            // Silent
        } finally {
            setRetrying(null);
        }
    };

    const dependencyCount = patterns.filter(
        p => p.classification?.error_class === 'dependency'
    ).length;
    const configCount = patterns.filter(
        p => p.classification?.error_class === 'config'
    ).length;

    return (
        <div className="sys-panel sys-error-recovery">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <ShieldAlert size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Error Recovery</h3>
                </div>
                <button
                    className="sys-refresh-btn"
                    onClick={loadErrors}
                    title="Uppdatera"
                >
                    <RefreshCw size={13} className={loading ? 'sys-spin' : ''} />
                </button>
            </div>

            {/* Summary */}
            <div className="sys-wf-summary">
                <span className="sys-wf-pill" style={{ opacity: 0.7 }}>
                    {totalErrors} fel ({period})
                </span>
                {dependencyCount > 0 && (
                    <span className="sys-wf-pill sys-pill-critical">{dependencyCount} beroenden</span>
                )}
                {configCount > 0 && (
                    <span className="sys-wf-pill sys-pill-degraded">{configCount} config</span>
                )}
                {patterns.length === 0 && !loading && (
                    <span className="sys-wf-pill sys-pill-healthy">✓ Inga fel</span>
                )}
            </div>

            {/* Error patterns */}
            <div className="sys-wf-list" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                {patterns.length === 0 && !loading && (
                    <div className="sys-empty-state">Inga felmönster hittade — allt ser bra ut! 🎉</div>
                )}
                {patterns.map((p, i) => {
                    const errClass = p.classification?.error_class || 'unknown';
                    const color = severityColor(errClass);
                    const Icon = errClass === 'dependency' ? XCircle : errClass === 'config' ? AlertTriangle : Info;

                    return (
                        <div key={`${p.agent}-${p.action}-${i}`} className="sys-wf-row">
                            <div className="sys-wf-status-icon">
                                <Icon size={14} style={{ color }} />
                            </div>
                            <div className="sys-wf-info" style={{ flex: 1 }}>
                                <span className="sys-wf-name">
                                    {p.agent} → {p.action}
                                </span>
                                <span className="sys-wf-meta">
                                    {p.count}x · {timeAgo(p.last_seen)}
                                    {p.classification?.suggested_action && (
                                        <> · {p.classification.suggested_action}</>
                                    )}
                                </span>
                            </div>
                            <button
                                className="sys-retry-btn"
                                onClick={() => handleRetry(p)}
                                disabled={retrying === p.agent}
                                title="Försök igen"
                                style={{
                                    background: 'none',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    color: 'var(--text-secondary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px',
                                    opacity: retrying === p.agent ? 0.5 : 1,
                                }}
                            >
                                <RotateCcw size={11} className={retrying === p.agent ? 'sys-spin' : ''} />
                                Retry
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="sys-panel-footer">
                <span className="sys-footer-text">
                    {patterns.length} mönster · Senaste {period}
                </span>
            </div>
        </div>
    );
}
