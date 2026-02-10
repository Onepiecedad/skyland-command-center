import { useEffect, useState, useCallback, useMemo } from 'react';
import type { Activity } from '../api';
import { fetchActivities } from '../api';
import { SegmentedControl } from './SegmentedControl';

/* ─── Filter Configuration ─── */
interface FilterConfig {
    key: string;
    label: string;
    icon: string;
    /** Maps to server-side query params */
    query: { event_type?: string; severity?: string };
}

const FILTERS: FilterConfig[] = [
    { key: 'all', label: 'Alla', icon: '📊', query: {} },
    { key: 'tool', label: 'Tool calls', icon: '🔧', query: { event_type: 'tool_call' } },
    { key: 'response', label: 'Svar', icon: '🤖', query: { event_type: 'chat_responded' } },
    { key: 'message', label: 'Meddelanden', icon: '👤', query: { event_type: 'chat_received' } },
    { key: 'error', label: 'Fel', icon: '⚠️', query: { severity: 'error' } },
    { key: 'cron', label: 'Cron', icon: '🔄', query: { event_type: 'cron_trigger' } },
];

const SEGMENTS = FILTERS.map(f => ({
    key: f.key,
    label: `${f.icon} ${f.label}`,
}));

/* ─── Type icons for the event_type column ─── */
const EVENT_TYPE_ICONS: Record<string, string> = {
    tool_call: '🔧',
    chat_responded: '🤖',
    chat_received: '👤',
    task_proposed: '📋',
    run_dispatched: '🚀',
    run_completed: '✅',
    run_failed: '❌',
    run_timeout: '⏱',
    cron_trigger: '🔄',
    heartbeat: '💓',
};

interface Props {
    selectedCustomerId: string | null;
}

export function ActivityLog({ selectedCustomerId }: Props) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('all');

    /* Resolve current filter config */
    const currentFilter = useMemo(
        () => FILTERS.find(f => f.key === activeFilter) || FILTERS[0],
        [activeFilter]
    );

    const loadActivities = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchActivities({
                limit: 80,
                offset: 0,
                customer_id: selectedCustomerId || undefined,
                ...currentFilter.query,
            });
            setActivities(data);
        } catch (err) {
            console.error('Failed to fetch activities:', err);
        }
        setLoading(false);
    }, [selectedCustomerId, currentFilter]);

    useEffect(() => {
        void loadActivities();
        const interval = setInterval(() => void loadActivities(), 10000);
        return () => clearInterval(interval);
    }, [loadActivities]);

    /* ─── Helpers ─── */
    const getSeverityClass = (severity: string) =>
        severity === 'error' ? 'severity-dot--error'
            : severity === 'warn' ? 'severity-dot--warn'
                : '';

    const formatTime = (iso: string) =>
        new Date(iso).toLocaleTimeString('sv-SE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });

    const getEventIcon = (eventType: string) =>
        EVENT_TYPE_ICONS[eventType] || '•';

    /* Count errors for badge */
    const errorCount = useMemo(
        () => activities.filter(a => a.severity === 'error').length,
        [activities]
    );

    return (
        <div className="panel activity-panel">
            {/* ─── Filter Bar ─── */}
            <div className="activity-filter-bar">
                <SegmentedControl
                    segments={SEGMENTS}
                    activeKey={activeFilter}
                    onSelect={setActiveFilter}
                />
                {activeFilter === 'all' && errorCount > 0 && (
                    <span className="activity-error-badge">{errorCount} fel</span>
                )}
            </div>

            {/* ─── Activity List ─── */}
            {loading ? (
                <div className="activity-loading">
                    <span className="activity-loading-dot" />
                    <span>Laddar…</span>
                </div>
            ) : (
                <div className="activity-list">
                    {activities.length === 0 ? (
                        <p className="empty">
                            {activeFilter === 'all'
                                ? 'Inga aktiviteter'
                                : `Inga ${currentFilter.label.toLowerCase()} hittades`}
                        </p>
                    ) : (
                        activities.map(a => (
                            <div
                                key={a.id}
                                className={`activity-row ${a.severity === 'error' ? 'activity-row--error' : ''}`}
                            >
                                <span className="activity-time">{formatTime(a.created_at)}</span>
                                <span
                                    className={`severity-dot ${getSeverityClass(a.severity)}`}
                                    title={a.severity}
                                />
                                <span className="activity-type-icon" title={a.event_type}>
                                    {getEventIcon(a.event_type)}
                                </span>
                                <span className="activity-agent">{a.agent}</span>
                                <span className="activity-action">{a.action}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
