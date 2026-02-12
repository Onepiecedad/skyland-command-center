import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Radio,
    RefreshCw,
    Circle,
    AlertTriangle,
    CheckCircle,
    Info,
    Zap,
} from 'lucide-react';
import { connectEventStream, fetchRecentEvents } from '../../api/system';
import type { StreamEvent } from '../../api/types';

// ─── Helpers ───

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 10) return 'Just nu';
    if (secs < 60) return `${secs}s sedan`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    return `${Math.floor(hours / 24)}d sedan`;
}

const EVENT_ICONS: Record<string, typeof Info> = {
    error: AlertTriangle,
    success: CheckCircle,
    dispatch: Zap,
};

function getEventIcon(type: string) {
    return EVENT_ICONS[type] || Info;
}

function getEventColor(type: string): string {
    if (type.includes('error') || type.includes('fail')) return 'var(--accent-red, #f87171)';
    if (type.includes('success') || type.includes('complete')) return 'var(--accent-green, #34d399)';
    if (type.includes('dispatch') || type.includes('start')) return 'var(--accent-blue, #60a5fa)';
    return 'var(--text-secondary, #94a3b8)';
}

// ─── Component ───

export function EventFeedPanel() {
    const [events, setEvents] = useState<StreamEvent[]>([]);
    const [connected, setConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const eventSourceRef = useRef<EventSource | null>(null);

    // Load recent events as fallback / initial data
    const loadRecent = useCallback(async () => {
        try {
            setLoading(true);
            const data = await fetchRecentEvents(30);
            setEvents(data.events);
        } catch {
            // Silent — SSE will take over
        } finally {
            setLoading(false);
        }
    }, []);

    // Connect SSE
    useEffect(() => {
        loadRecent();

        try {
            const es = connectEventStream((event: StreamEvent) => {
                setEvents(prev => [event, ...prev].slice(0, 50));
            });

            es.onopen = () => setConnected(true);
            es.onerror = () => setConnected(false);

            eventSourceRef.current = es;

            return () => {
                es.close();
                setConnected(false);
            };
        } catch {
            // SSE not available, rely on polling
            setConnected(false);
        }
    }, [loadRecent]);

    const eventTypes = [...new Set(events.map(e => e.type))];
    const errorCount = events.filter(e => e.type.includes('error')).length;

    return (
        <div className="sys-panel sys-event-feed">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <Radio size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Event Feed</h3>
                    <span
                        className={`sys-connection-dot ${connected ? 'sys-dot-live' : 'sys-dot-off'}`}
                        title={connected ? 'Live SSE' : 'Offline — visar historik'}
                    >
                        <Circle size={8} fill="currentColor" />
                    </span>
                </div>
                <button
                    className="sys-refresh-btn"
                    onClick={loadRecent}
                    title="Ladda senaste"
                >
                    <RefreshCw size={13} className={loading ? 'sys-spin' : ''} />
                </button>
            </div>

            {/* Summary */}
            <div className="sys-wf-summary">
                <span className="sys-wf-pill sys-pill-healthy">{events.length} events</span>
                {errorCount > 0 && (
                    <span className="sys-wf-pill sys-pill-critical">{errorCount} errors</span>
                )}
                <span className="sys-wf-pill" style={{ opacity: 0.6 }}>
                    {eventTypes.length} typer
                </span>
            </div>

            {/* Event list */}
            <div className="sys-wf-list" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                {events.length === 0 && !loading && (
                    <div className="sys-empty-state">Inga events ännu</div>
                )}
                {events.map((evt, i) => {
                    const Icon = getEventIcon(evt.type);
                    const color = getEventColor(evt.type);
                    return (
                        <div key={evt.id || i} className="sys-wf-row">
                            <div className="sys-wf-status-icon">
                                <Icon size={14} style={{ color }} />
                            </div>
                            <div className="sys-wf-info">
                                <span className="sys-wf-name">{evt.type}</span>
                                <span className="sys-wf-meta">
                                    {evt.source && <span>{evt.source}</span>}
                                    {' · '}
                                    {timeAgo(evt.timestamp)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="sys-panel-footer">
                <span className="sys-footer-text">
                    {connected ? '🟢 Live' : '⚪ Historik'} · {events.length} events
                </span>
            </div>
        </div>
    );
}
