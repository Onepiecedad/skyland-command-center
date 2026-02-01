import { useEffect, useState, useCallback } from 'react';
import type { Activity } from '../api';
import { fetchActivities } from '../api';

interface Props {
    selectedCustomerId: string | null;
}

export function ActivityLog({ selectedCustomerId }: Props) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);

    const loadActivities = useCallback(async () => {
        try {
            const data = await fetchActivities({
                limit: 50,
                offset: 0,
                customer_id: selectedCustomerId || undefined
            });
            setActivities(data);
        } catch (err) {
            console.error('Failed to fetch activities:', err);
        }
        setLoading(false);
    }, [selectedCustomerId]);

    useEffect(() => {
        loadActivities();
        // Auto-refresh every 10s
        const interval = setInterval(loadActivities, 10000);
        return () => clearInterval(interval);
    }, [loadActivities]);

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'error': return '#ef4444';
            case 'warn': return '#f59e0b';
            default: return '#6b7280';
        }
    };

    const getAutonomyBadge = (level: string) => {
        const colors: Record<string, string> = {
            'OBSERVE': '#3b82f6',
            'SUGGEST': '#8b5cf6',
            'ACT': '#22c55e',
            'SILENT': '#6b7280'
        };
        return colors[level] || '#6b7280';
    };

    const formatTime = (iso: string) => {
        return new Date(iso).toLocaleTimeString('sv-SE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    return (
        <div className="panel">
            <h2>📊 Activity Log {selectedCustomerId && '(filtered)'}</h2>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <div className="activity-list">
                    {activities.length === 0 ? (
                        <p className="empty">No activities</p>
                    ) : (
                        activities.map(a => (
                            <div key={a.id} className="activity-row">
                                <span className="activity-time">{formatTime(a.created_at)}</span>
                                <span
                                    className="severity-dot"
                                    style={{ backgroundColor: getSeverityColor(a.severity) }}
                                    title={a.severity}
                                />
                                <span className="activity-agent">{a.agent}</span>
                                <span className="activity-action">{a.action}</span>
                                <span className="activity-type">[{a.event_type}]</span>
                                <span
                                    className="autonomy-badge"
                                    style={{ backgroundColor: getAutonomyBadge(a.autonomy_level) }}
                                >
                                    {a.autonomy_level}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
