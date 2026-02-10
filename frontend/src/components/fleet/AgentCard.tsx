import { Cpu, MessageSquare, Globe, Smartphone } from 'lucide-react';
import type { AgentData } from '../../gateway/fleetApi';

interface AgentCardProps {
    agent: AgentData;
    onClick: () => void;
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
    whatsapp: <Smartphone size={12} />,
    web: <Globe size={12} />,
    scc: <MessageSquare size={12} />,
};

function getModelShort(model?: string): string | null {
    if (!model) return null;
    // "openrouter/pony-alpha" → "pony-alpha"
    const last = model.split('/').pop() || model;
    // Truncate very long model names
    return last.length > 16 ? last.slice(0, 14) + '…' : last;
}

export default function AgentCard({ agent, onClick }: AgentCardProps) {
    const statusLabel = {
        active: 'Aktiv',
        waiting: 'Väntar',
        idle: 'Inaktiv',
        error: 'Fel',
    }[agent.status];

    const channelIcon = CHANNEL_ICONS[agent.channel || ''] || null;
    const modelShort = getModelShort(agent.model);

    return (
        <button
            className={`agent-card status-${agent.status}`}
            onClick={onClick}
            type="button"
        >
            {/* Header */}
            <div className="agent-card-header">
                <div className="agent-card-identity">
                    <div className={`agent-card-dot status-${agent.status}`} />
                    <h3 className="agent-card-name">
                        {channelIcon && <span className="agent-card-channel-icon">{channelIcon}</span>}
                        {agent.name}
                    </h3>
                </div>
                <span className={`agent-card-status status-${agent.status}`}>{statusLabel}</span>
            </div>

            {/* Role */}
            <span className="agent-card-role">{agent.role}</span>

            {/* Task */}
            <p className="agent-card-task">{agent.currentTask}</p>

            {/* Footer */}
            <div className="agent-card-footer">
                <span className="agent-card-uptime">{agent.uptime}</span>
                {modelShort && (
                    <span className="agent-card-model">
                        <Cpu size={10} />
                        {modelShort}
                    </span>
                )}
            </div>
        </button>
    );
}
