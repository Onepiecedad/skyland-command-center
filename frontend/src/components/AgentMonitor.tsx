/**
 * AgentMonitor — Compact Sub-Agent Visibility Panel
 *
 * Shows real-time gateway connection status, Alex state,
 * connected nodes, and uptime. Designed as a compact strip
 * for the main dashboard header area.
 */
import { useGateway } from '../gateway/useGateway';
import { useMemo } from 'react';
import type { GatewayNode } from '../gateway/gatewaySocket';

// ─── State Config ───
const STATE_CONFIG: Record<string, { label: string; icon: string; class: string }> = {
    idle: { label: 'Redo', icon: '😴', class: 'agent-state--idle' },
    thinking: { label: 'Tänker…', icon: '🧠', class: 'agent-state--thinking' },
    executing: { label: 'Kör verktyg', icon: '⚡', class: 'agent-state--executing' },
    stuck: { label: 'Fastnat', icon: '🚨', class: 'agent-state--stuck' },
    unknown: { label: 'Okänd', icon: '❓', class: 'agent-state--unknown' },
};

// ─── Node Icons ───
function getNodeIcon(platform: string): string {
    const p = platform.toLowerCase();
    if (p.includes('claude') || p.includes('anthropic')) return '🤖';
    if (p.includes('openai') || p.includes('gpt')) return '🧠';
    if (p.includes('slack')) return '💬';
    if (p.includes('whatsapp')) return '📱';
    if (p.includes('discord')) return '🎮';
    if (p.includes('web') || p.includes('http')) return '🌐';
    if (p.includes('cron') || p.includes('schedule')) return '⏰';
    return '🔌';
}

export function AgentMonitor() {
    const { status, alexState, nodes } = useGateway('agent:skyland:main');

    const stateConf = STATE_CONFIG[alexState] || STATE_CONFIG.unknown;
    const isOnline = status === 'connected';
    const connectedCount = useMemo(() => nodes.filter((n: GatewayNode) => n.connected).length, [nodes]);

    return (
        <div className="agent-monitor">
            {/* ─── Gateway Status Pill ─── */}
            {/* Gateway = Joakims dator (kör pipelines). Nås den inte (mobil/molnet)
                betyder det INTE att systemet är nere — server-Alex + CRM funkar
                ändå. Därför "Moln" i stället för det alarmerande "Offline". */}
            <div className={`am-gateway-pill ${isOnline ? 'am-online' : 'am-offline'}`}
                title={isOnline ? 'Gatewayn (din dator) är ansluten — pipelines kan köras' : 'Gatewayn (din dator) nås inte just nu. Server-Alex och CRM fungerar ändå.'}>
                <span className={`am-dot ${isOnline ? 'am-dot--online' : 'am-dot--offline'}`} />
                <span className="am-gateway-label">
                    {isOnline ? 'Gateway' : status === 'connecting' ? 'Ansluter…' : 'Moln'}
                </span>
            </div>

            {/* ─── Alex State ─── */}
            <div className={`am-alex-state ${stateConf.class}`}>
                <span className="am-state-icon">{stateConf.icon}</span>
                <span className="am-state-label">{stateConf.label}</span>
            </div>

            {/* ─── Node Count ─── */}
            <div className="am-nodes-summary">
                <span className="am-nodes-count">{connectedCount}</span>
                <span className="am-nodes-label">nod{connectedCount !== 1 ? 'er' : ''}</span>
            </div>

            {/* ─── Expanded Node List (hover/tooltip) ─── */}
            {nodes.length > 0 && (
                <div className="am-nodes-dropdown">
                    {nodes.map((node: GatewayNode) => (
                        <div
                            key={node.id}
                            className={`am-node-row ${node.connected ? 'am-node--connected' : 'am-node--disconnected'}`}
                        >
                            <span className={`am-dot ${node.connected ? 'am-dot--online' : 'am-dot--offline'}`} />
                            <span className="am-node-icon">{getNodeIcon(node.platform)}</span>
                            <span className="am-node-name">{node.name || node.id}</span>
                            <span className="am-node-platform">{node.platform}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
