import { useMemo, useRef } from 'react';
import { Activity, Clock, AlertCircle, Play, Pause } from 'lucide-react';
import type { AgentData } from '../../gateway/fleetApi';

interface ActivityTimelineProps {
    agents: AgentData[];
}

interface TimelineEvent {
    id: string;
    agentName: string;
    type: 'active' | 'waiting' | 'idle' | 'error';
    time: string;
    relativeTime: string;
    message: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
    active: { icon: <Play size={12} />, className: 'evt-active', label: 'Aktiv' },
    waiting: { icon: <Pause size={12} />, className: 'evt-waiting', label: 'Väntar' },
    idle: { icon: <Clock size={12} />, className: 'evt-idle', label: 'Inaktiv' },
    error: { icon: <AlertCircle size={12} />, className: 'evt-error', label: 'Fel' },
};

function relativeTime(ms: number): string {
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'nyss';
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    return `${Math.floor(hours / 24)}d sedan`;
}

export default function ActivityTimeline({ agents }: ActivityTimelineProps) {
    // Capture "now" once per render via a ref to avoid impure function in useMemo
    const nowRef = useRef(Date.now());
    nowRef.current = Date.now();

    const events = useMemo<TimelineEvent[]>(() => {
        const now = nowRef.current;
        return agents
            .filter(a => a.updatedAt)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, 20)
            .map(agent => ({
                id: `evt-${agent.id}`,
                agentName: agent.name,
                type: agent.status,
                time: agent.updatedAt
                    ? new Date(agent.updatedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                    : '—',
                relativeTime: relativeTime(now - (agent.updatedAt || now)),
                message: agent.currentTask,
            }));
    }, [agents]);

    if (events.length === 0) return null;

    return (
        <section className="activity-timeline">
            <div className="activity-timeline-header">
                <Activity size={16} />
                <h3>Aktivitetslogg</h3>
                <span className="activity-timeline-count">{events.length}</span>
            </div>
            <ul className="activity-timeline-list">
                {events.map(evt => {
                    const cfg = TYPE_CONFIG[evt.type];
                    return (
                        <li key={evt.id} className="activity-timeline-item">
                            <span className={`activity-dot ${cfg.className}`} />
                            <div className="activity-content">
                                <div className="activity-meta">
                                    <span className="activity-agent">{evt.agentName}</span>
                                    <span className={`activity-badge ${cfg.className}`}>
                                        {cfg.icon} {cfg.label}
                                    </span>
                                </div>
                                <p className="activity-message">{evt.message}</p>
                            </div>
                            <span className="activity-time">{evt.relativeTime}</span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
