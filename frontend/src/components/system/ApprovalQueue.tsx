import { useState, useEffect, useCallback } from 'react';
import {
    ShieldAlert,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Clock,
    Bell,
    RefreshCw,
} from 'lucide-react';
import type { Task, Activity } from '../../api';
import { fetchTasks, fetchActivities, approveTask } from '../../api';

// ─── Types ───
interface QueueItem {
    id: string;
    type: 'approval' | 'alert';
    title: string;
    description: string;
    severity: 'info' | 'warn' | 'error';
    timestamp: string;
    taskId?: string;
    agent?: string;
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just nu';
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    return `${Math.floor(hours / 24)}d sedan`;
}

const SEVERITY_CONFIG = {
    info: { color: 'var(--accent-blue, #0a84ff)', icon: Bell },
    warn: { color: 'var(--accent-yellow, #fbbf24)', icon: AlertTriangle },
    error: { color: 'var(--accent-red, #f87171)', icon: ShieldAlert },
};

export function ApprovalQueue() {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState<string | null>(null);

    const fetchQueue = useCallback(async () => {
        const queue: QueueItem[] = [];
        try {
            // Fetch pending approval tasks
            const tasks: Task[] = await fetchTasks({ status: 'review', limit: 10 });
            for (const t of tasks) {
                queue.push({
                    id: `task-${t.id}`,
                    type: 'approval',
                    title: t.title,
                    description: `${t.executor} — Prioritet: ${t.priority}`,
                    severity: t.priority === 'urgent' ? 'error' : t.priority === 'high' ? 'warn' : 'info',
                    timestamp: t.updated_at || t.created_at,
                    taskId: t.id,
                    agent: t.assigned_agent || t.executor,
                });
            }
        } catch { /* API might be down */ }

        try {
            // Fetch recent critical activities
            const activities: Activity[] = await fetchActivities({ severity: 'error', limit: 5 });
            for (const a of activities) {
                queue.push({
                    id: `act-${a.id}`,
                    type: 'alert',
                    title: a.action,
                    description: `Agent: ${a.agent} — ${a.event_type}`,
                    severity: a.severity,
                    timestamp: a.created_at,
                    agent: a.agent,
                });
            }
        } catch { /* API might be down */ }

        // Sort by timestamp descending
        queue.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setItems(queue);
        setLoading(false);
    }, []);

    useEffect(() => { fetchQueue(); }, [fetchQueue]);

    // Auto-refresh
    useEffect(() => {
        const interval = setInterval(fetchQueue, 15000);
        return () => clearInterval(interval);
    }, [fetchQueue]);

    const handleApprove = async (item: QueueItem) => {
        if (!item.taskId) return;
        setApproving(item.id);
        try {
            await approveTask(item.taskId, 'joakim');
            setItems(prev => prev.filter(i => i.id !== item.id));
        } catch {
            // Handle error
        }
        setApproving(null);
    };

    const handleDismiss = (itemId: string) => {
        setItems(prev => prev.filter(i => i.id !== itemId));
    };

    const approvalCount = items.filter(i => i.type === 'approval').length;
    const alertCount = items.filter(i => i.type === 'alert').length;

    return (
        <div className="sys-panel sys-approvals">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <ShieldAlert size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Notifieringar & Godkännanden</h3>
                    {items.length > 0 && (
                        <span className="sys-queue-badge">{items.length}</span>
                    )}
                </div>
                <button className="sys-refresh-btn" onClick={fetchQueue} title="Uppdatera">
                    <RefreshCw size={13} className={loading ? 'sys-spin' : ''} />
                </button>
            </div>

            {/* Summary */}
            <div className="sys-approval-summary">
                {approvalCount > 0 && (
                    <span className="sys-wf-pill sys-pill-degraded">
                        {approvalCount} väntar godkännande
                    </span>
                )}
                {alertCount > 0 && (
                    <span className="sys-wf-pill sys-pill-critical">
                        {alertCount} varningar
                    </span>
                )}
                {items.length === 0 && !loading && (
                    <span className="sys-queue-empty">✅ Allt lugnt — inga åtgärder krävs</span>
                )}
            </div>

            {/* Queue items */}
            <div className="sys-queue-list">
                {items.map(item => {
                    const conf = SEVERITY_CONFIG[item.severity];
                    const Icon = conf.icon;
                    return (
                        <div
                            key={item.id}
                            className={`sys-queue-item sys-sev-${item.severity} ${item.severity === 'error' ? 'sys-pulse' : ''}`}
                        >
                            <div className="sys-queue-icon" style={{ color: conf.color }}>
                                <Icon size={15} />
                            </div>
                            <div className="sys-queue-content">
                                <span className="sys-queue-title">{item.title}</span>
                                <span className="sys-queue-desc">{item.description}</span>
                                <span className="sys-queue-time">
                                    <Clock size={10} />
                                    {timeAgo(item.timestamp)}
                                </span>
                            </div>
                            <div className="sys-queue-actions">
                                {item.type === 'approval' && (
                                    <button
                                        className="sys-approve-btn"
                                        onClick={() => handleApprove(item)}
                                        disabled={approving === item.id}
                                    >
                                        <CheckCircle size={13} />
                                        {approving === item.id ? '…' : 'Godkänn'}
                                    </button>
                                )}
                                <button
                                    className="sys-dismiss-btn"
                                    onClick={() => handleDismiss(item.id)}
                                    title="Avfärda"
                                >
                                    <XCircle size={13} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
