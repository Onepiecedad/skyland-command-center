import { useState, useEffect, useCallback } from 'react';
import {
    Database,
    RefreshCw,
    Trash2,
    Settings,
    HardDrive,
} from 'lucide-react';
import {
    fetchStorageOverview,
    fetchRetentionPolicy,
    runMemoryCleanup,
} from '../../api/system';

// ─── Types ───

interface StorageInfo {
    row_count: number;
    oldest_record?: string;
    newest_record?: string;
}

interface RetentionPolicy {
    activities_days: number;
    messages_days: number;
    task_runs_days: number;
}

// ─── Helpers ───

function formatNumber(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
}

function daysAgo(iso: string | undefined): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'Idag';
    if (days === 1) return '1 dag';
    return `${days} dagar`;
}

const TABLE_LABELS: Record<string, string> = {
    activities: 'Aktiviteter',
    messages: 'Meddelanden',
    tasks: 'Tasks',
    task_runs: 'Task Runs',
    costs: 'Kostnader',
};

// ─── Component ───

export function MemoryManagementPanel() {
    const [storage, setStorage] = useState<Record<string, StorageInfo>>({});
    const [totalRows, setTotalRows] = useState(0);
    const [retention, setRetention] = useState<RetentionPolicy | null>(null);
    const [loading, setLoading] = useState(true);
    const [cleaning, setCleaning] = useState(false);
    const [cleanupResult, setCleanupResult] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [storageData, retentionData] = await Promise.all([
                fetchStorageOverview(),
                fetchRetentionPolicy().catch(() => null),
            ]);
            setStorage(storageData.storage);
            setTotalRows(storageData.total_rows);
            if (retentionData?.policy) {
                setRetention(retentionData.policy);
            }
        } catch {
            // Silent
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleCleanup = async () => {
        try {
            setCleaning(true);
            setCleanupResult(null);
            const result = await runMemoryCleanup();
            setCleanupResult(`Rensat ${result.total_deleted} rader`);
            await loadData();
        } catch {
            setCleanupResult('Fel vid rensning');
        } finally {
            setCleaning(false);
        }
    };

    const sortedTables = Object.entries(storage)
        .sort(([, a], [, b]) => b.row_count - a.row_count);

    return (
        <div className="sys-panel sys-memory-mgmt">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <Database size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Minneshantering</h3>
                </div>
                <button
                    className="sys-refresh-btn"
                    onClick={loadData}
                    title="Uppdatera"
                >
                    <RefreshCw size={13} className={loading ? 'sys-spin' : ''} />
                </button>
            </div>

            {/* Summary */}
            <div className="sys-wf-summary">
                <span className="sys-wf-pill sys-pill-healthy">
                    <HardDrive size={11} style={{ marginRight: 4 }} />
                    {formatNumber(totalRows)} rader totalt
                </span>
                {retention && (
                    <span className="sys-wf-pill" style={{ opacity: 0.6 }}>
                        <Settings size={11} style={{ marginRight: 4 }} />
                        Retention aktiv
                    </span>
                )}
            </div>

            {/* Storage table */}
            <div className="sys-wf-list">
                {sortedTables.map(([table, info]) => {
                    const pct = totalRows > 0 ? (info.row_count / totalRows) * 100 : 0;
                    return (
                        <div key={table} className="sys-wf-row">
                            <div className="sys-wf-info" style={{ flex: 1 }}>
                                <span className="sys-wf-name">
                                    {TABLE_LABELS[table] || table}
                                </span>
                                <span className="sys-wf-meta">
                                    Äldsta: {daysAgo(info.oldest_record)} · Nyaste: {daysAgo(info.newest_record)}
                                </span>
                            </div>
                            <div style={{ textAlign: 'right', minWidth: 80 }}>
                                <div className="sys-wf-runs" style={{ fontWeight: 600 }}>
                                    {formatNumber(info.row_count)}
                                </div>
                                <div style={{
                                    height: 3,
                                    background: 'rgba(255,255,255,0.06)',
                                    borderRadius: 2,
                                    marginTop: 4,
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${Math.max(pct, 2)}%`,
                                        background: 'var(--accent-blue, #60a5fa)',
                                        borderRadius: 2,
                                        transition: 'width 0.3s ease',
                                    }} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Retention info */}
            {retention && (
                <div style={{
                    padding: '8px 12px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                }}>
                    Retention: Aktiviteter {retention.activities_days}d · Meddelanden {retention.messages_days}d · Runs {retention.task_runs_days}d
                </div>
            )}

            <div className="sys-panel-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="sys-footer-text">
                    {cleanupResult || `${sortedTables.length} tabeller`}
                </span>
                <button
                    onClick={handleCleanup}
                    disabled={cleaning}
                    title="Kör retention-baserad rensning"
                    style={{
                        background: 'none',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        cursor: cleaning ? 'wait' : 'pointer',
                        color: 'var(--accent-red, #f87171)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        opacity: cleaning ? 0.5 : 0.8,
                    }}
                >
                    <Trash2 size={11} className={cleaning ? 'sys-spin' : ''} />
                    Rensa
                </button>
            </div>
        </div>
    );
}
