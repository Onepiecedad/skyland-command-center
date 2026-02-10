import { useMemo } from 'react';
import { useGateway } from '../../gateway/useGateway';
import type { GatewayNode } from '../../gateway/gatewaySocket';
import {
    Wifi,
    WifiOff,
    Brain,
    Cpu,
    Zap,
    AlertCircle,
    HelpCircle,
    MonitorSmartphone,
} from 'lucide-react';

// ─── Agent State Config ───
const STATE_CONFIG: Record<string, { label: string; icon: typeof Brain; color: string; className: string }> = {
    idle: { label: 'Redo', icon: Brain, color: '#34d399', className: 'sys-state-idle' },
    thinking: { label: 'Tänker…', icon: Cpu, color: '#fbbf24', className: 'sys-state-thinking' },
    executing: { label: 'Kör verktyg…', icon: Zap, color: '#0a84ff', className: 'sys-state-executing' },
    stuck: { label: 'Fastnat', icon: AlertCircle, color: '#f87171', className: 'sys-state-stuck' },
    unknown: { label: 'Okänd', icon: HelpCircle, color: '#64748b', className: 'sys-state-unknown' },
};

function getNodeIcon(platform: string): typeof Brain {
    const p = platform.toLowerCase();
    if (p.includes('claude') || p.includes('anthropic')) return Brain;
    if (p.includes('openai') || p.includes('gpt')) return Cpu;
    if (p.includes('web') || p.includes('http')) return MonitorSmartphone;
    return Zap;
}

export function AgentStatusPanel() {
    const gateway = useGateway('agent:skyland:main');
    const isOnline = gateway.status === 'connected';
    const stateConf = STATE_CONFIG[gateway.alexState] || STATE_CONFIG.unknown;
    const StateIcon = stateConf.icon;

    const connectedNodes = useMemo(
        () => gateway.nodes.filter((n: GatewayNode) => n.connected),
        [gateway.nodes]
    );

    return (
        <div className="sys-panel sys-agent-status">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <Brain size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Agent Status</h3>
                </div>
            </div>

            {/* Main gateway + agent status */}
            <div className="sys-agent-hero">
                <div className={`sys-agent-gateway ${isOnline ? 'sys-online' : 'sys-offline'}`}>
                    {isOnline ? <Wifi size={18} /> : <WifiOff size={18} />}
                    <div className="sys-agent-gateway-info">
                        <span className="sys-agent-gateway-label">
                            {isOnline ? 'Gateway Online' : gateway.status === 'connecting' ? 'Ansluter…' : 'Gateway Offline'}
                        </span>
                        <span className="sys-agent-gateway-sub">agent:skyland:main</span>
                    </div>
                </div>

                {isOnline && (
                    <div className={`sys-agent-state-card ${stateConf.className}`}>
                        <StateIcon size={20} style={{ color: stateConf.color }} />
                        <div className="sys-agent-state-info">
                            <span className="sys-agent-state-label" style={{ color: stateConf.color }}>{stateConf.label}</span>
                            <span className="sys-agent-state-name">Alex</span>
                        </div>
                        {gateway.alexState === 'thinking' && (
                            <div className="sys-thinking-dots">
                                <span /><span /><span />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Connected nodes */}
            <div className="sys-nodes-section">
                <div className="sys-nodes-header">
                    <span className="sys-nodes-title">Anslutna noder</span>
                    <span className="sys-nodes-count">{connectedNodes.length}</span>
                </div>
                <div className="sys-nodes-list">
                    {gateway.nodes.length === 0 ? (
                        <span className="sys-nodes-empty">Inga noder registrerade</span>
                    ) : (
                        gateway.nodes.map((node: GatewayNode) => {
                            const NodeIcon = getNodeIcon(node.platform);
                            return (
                                <div key={node.id} className={`sys-node-row ${node.connected ? 'sys-node-on' : 'sys-node-off'}`}>
                                    <span className={`sys-node-dot ${node.connected ? 'on' : 'off'}`} />
                                    <NodeIcon size={13} />
                                    <span className="sys-node-name">{node.name || node.id}</span>
                                    <span className="sys-node-platform">{node.platform}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Session stats */}
            <div className="sys-agent-stats">
                <div className="sys-stat">
                    <span className="sys-stat-value">{gateway.messages.length}</span>
                    <span className="sys-stat-label">Meddelanden</span>
                </div>
                <div className="sys-stat">
                    <span className="sys-stat-value">{connectedNodes.length}</span>
                    <span className="sys-stat-label">Noder</span>
                </div>
                <div className="sys-stat">
                    <span className="sys-stat-value">{isOnline ? '●' : '○'}</span>
                    <span className="sys-stat-label">Status</span>
                </div>
            </div>
        </div>
    );
}
