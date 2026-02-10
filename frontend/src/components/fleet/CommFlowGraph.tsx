import { useMemo } from 'react';
import { Zap } from 'lucide-react';
import type { AgentData } from '../../gateway/fleetApi';

interface CommFlowGraphProps {
    agents: AgentData[];
}

const STATUS_COLORS: Record<string, string> = {
    active: '#22c55e',
    waiting: '#f59e0b',
    idle: '#64748b',
    error: '#ef4444',
};

export default function CommFlowGraph({ agents }: CommFlowGraphProps) {
    const { hub, satellites } = useMemo(() => {
        const main = agents.find(a => a.sessionKey.includes(':main'));
        const others = agents
            .filter(a => !a.sessionKey.includes(':main'))
            .sort((a, b) => {
                const order = { active: 0, waiting: 1, idle: 2, error: 3 };
                return (order[a.status] ?? 4) - (order[b.status] ?? 4);
            })
            .slice(0, 12); // Cap at 12 satellites for readability
        return { hub: main || null, satellites: others };
    }, [agents]);

    if (!hub && satellites.length === 0) return null;

    const cx = 140, cy = 130;
    const radius = 95;

    return (
        <section className="comm-flow-graph">
            <div className="comm-flow-header">
                <Zap size={16} />
                <h3>Kommunikationsflöde</h3>
            </div>
            <svg viewBox="0 0 280 260" className="comm-flow-svg">
                {/* Connection lines */}
                {satellites.map((agent, i) => {
                    const angle = (2 * Math.PI * i) / satellites.length - Math.PI / 2;
                    const x = cx + radius * Math.cos(angle);
                    const y = cy + radius * Math.sin(angle);
                    const color = STATUS_COLORS[agent.status] || '#64748b';
                    return (
                        <line
                            key={`line-${agent.id}`}
                            x1={cx} y1={cy}
                            x2={x} y2={y}
                            stroke={color}
                            strokeWidth={agent.status === 'active' ? 2 : 1}
                            strokeOpacity={agent.status === 'idle' ? 0.25 : 0.6}
                            className={agent.status === 'active' ? 'comm-line-pulse' : ''}
                        />
                    );
                })}

                {/* Satellite nodes */}
                {satellites.map((agent, i) => {
                    const angle = (2 * Math.PI * i) / satellites.length - Math.PI / 2;
                    const x = cx + radius * Math.cos(angle);
                    const y = cy + radius * Math.sin(angle);
                    const color = STATUS_COLORS[agent.status] || '#64748b';
                    const r = agent.status === 'active' ? 8 : 6;
                    return (
                        <g key={`node-${agent.id}`}>
                            {agent.status === 'active' && (
                                <circle cx={x} cy={y} r={r + 4} fill={color} opacity={0.15} className="comm-node-glow" />
                            )}
                            <circle
                                cx={x} cy={y} r={r}
                                fill="#0d1117"
                                stroke={color}
                                strokeWidth={1.5}
                            />
                            <title>{agent.name} — {agent.role}</title>
                        </g>
                    );
                })}

                {/* Hub node (Alex) */}
                {hub && (
                    <g>
                        <circle cx={cx} cy={cy} r={16} fill="#8B5CF6" opacity={0.15} className="comm-hub-glow" />
                        <circle cx={cx} cy={cy} r={12} fill="#0d1117" stroke="#8B5CF6" strokeWidth={2} />
                        <text x={cx} y={cy + 4} textAnchor="middle" fill="#8B5CF6" fontSize="9" fontWeight="700">A</text>
                    </g>
                )}

                {/* Legend */}
                <g transform="translate(4, 242)">
                    <circle cx={6} cy={6} r={4} fill="#22c55e" />
                    <text x={14} y={10} fill="#94a3b8" fontSize="8">Aktiv</text>
                    <circle cx={54} cy={6} r={4} fill="#f59e0b" />
                    <text x={62} y={10} fill="#94a3b8" fontSize="8">Väntar</text>
                    <circle cx={106} cy={6} r={4} fill="#64748b" />
                    <text x={114} y={10} fill="#94a3b8" fontSize="8">Inaktiv</text>
                </g>
            </svg>
        </section>
    );
}
