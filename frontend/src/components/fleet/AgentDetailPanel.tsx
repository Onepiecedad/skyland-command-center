import { useEffect, useState } from 'react';
import { X, Clock, Cpu, MessageSquare, Server, Loader2 } from 'lucide-react';
import type { AgentData, AgentDetail } from '../../gateway/fleetApi';
import { fetchAgentDetail } from '../../gateway/fleetApi';

interface AgentDetailPanelProps {
    agent: AgentData;
    onClose: () => void;
}

export default function AgentDetailPanel({ agent, onClose }: AgentDetailPanelProps) {
    const [detail, setDetail] = useState<AgentDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        fetchAgentDetail(agent.sessionKey)
            .then(d => {
                if (!cancelled) {
                    setDetail(d);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [agent.sessionKey]);

    // Escape key handler
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const statusLabel = {
        active: 'Aktiv',
        waiting: 'Väntar',
        idle: 'Inaktiv',
        error: 'Fel',
    }[agent.status];

    return (
        <>
            {/* Overlay backdrop */}
            <div className="agent-detail-overlay" onClick={onClose} />

            {/* Panel */}
            <aside className="agent-detail-panel">
                {/* Header */}
                <div className="agent-detail-header">
                    <div className="agent-detail-identity">
                        <div className={`agent-detail-status-dot status-${agent.status}`} />
                        <div>
                            <h2>{agent.name}</h2>
                            <span className="agent-detail-role">{agent.role}</span>
                        </div>
                    </div>
                    <button className="agent-detail-close" onClick={onClose} type="button" aria-label="Stäng detaljpanel">
                        <X size={20} />
                    </button>
                </div>

                {/* Status badge */}
                <div className={`agent-detail-status-badge status-${agent.status}`}>
                    {statusLabel}
                </div>

                {/* Meta cards */}
                <div className="agent-detail-meta-grid">
                    <div className="meta-card">
                        <Clock size={16} />
                        <div>
                            <span className="meta-label">Senaste aktivitet</span>
                            <span className="meta-value">{agent.uptime}</span>
                        </div>
                    </div>
                    {agent.model && (
                        <div className="meta-card">
                            <Cpu size={16} />
                            <div>
                                <span className="meta-label">Modell</span>
                                <span className="meta-value">{agent.model.split('/').pop()}</span>
                            </div>
                        </div>
                    )}
                    {agent.channel && (
                        <div className="meta-card">
                            <MessageSquare size={16} />
                            <div>
                                <span className="meta-label">Kanal</span>
                                <span className="meta-value">{agent.channel}</span>
                            </div>
                        </div>
                    )}
                    {agent.totalTokens !== undefined && (
                        <div className="meta-card">
                            <Server size={16} />
                            <div>
                                <span className="meta-label">Tokens</span>
                                <span className="meta-value">{agent.totalTokens?.toLocaleString('sv-SE')}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Current task */}
                <div className="agent-detail-section">
                    <h3>Aktuell uppgift</h3>
                    <p className="agent-detail-task">{agent.currentTask}</p>
                </div>

                {/* Activity log */}
                <div className="agent-detail-section">
                    <h3>Aktivitetslogg</h3>
                    {loading ? (
                        <div className="agent-detail-loading">
                            <Loader2 size={20} className="spin" />
                        </div>
                    ) : detail && detail.logs.length > 0 ? (
                        <ul className="agent-detail-log-list">
                            {detail.logs.map((log, i) => (
                                <li key={i} className="agent-detail-log-entry">
                                    <span className="log-time">{log.time}</span>
                                    <span className="log-message">{log.message}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="agent-detail-empty">Ingen historik tillgänglig</p>
                    )}
                </div>
            </aside>
        </>
    );
}
