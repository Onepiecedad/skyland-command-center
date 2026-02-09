import { useState, useEffect, useCallback } from 'react';

interface AgentInfo {
    id: string;
    name: string;
    status: 'online' | 'offline' | 'busy';
    lastSeen: string;
    currentTask?: string;
}

interface SkillInfo {
    name: string;
    emoji: string;
    description: string;
    category: 'search' | 'automation' | 'content' | 'monitor' | 'system';
}

interface ConversationPreview {
    id: string;
    channel: string;
    lastMessage: string;
    timestamp: string;
    unread: boolean;
}

interface ActiveTask {
    id: string;
    title: string;
    agent: string;
    status: 'running' | 'waiting';
    startedAt: string;
    progress?: number;
}

// Skills registry — loaded from clawd/skills
const SKILLS: SkillInfo[] = [
    { name: 'exa-search', emoji: '🔍', description: 'Web, code & company research via Exa MCP', category: 'search' },
    { name: 'trend-research', emoji: '📡', description: 'Reddit & X parallel trend scanning', category: 'search' },
    { name: 'icp-deep-research', emoji: '🎯', description: 'Ideal customer profile deep research', category: 'search' },
    { name: 'feedback-scraper', emoji: '📢', description: 'Gather customer feedback from multiple channels', category: 'monitor' },
    { name: 'content-pipeline', emoji: '📝', description: 'Content creation & distribution workflow', category: 'content' },
    { name: 'client-monitor', emoji: '📊', description: 'Real-time client health monitoring', category: 'monitor' },
    { name: 'agent-mail', emoji: '📧', description: 'Email reading, composing & management', category: 'automation' },
    { name: 'caldav-calendar', emoji: '📅', description: 'Calendar access & event management', category: 'automation' },
    { name: 'n8n-admin', emoji: '⚙️', description: 'n8n workflow management & monitoring', category: 'system' },
    { name: 'task-logger', emoji: '📋', description: 'Automatic task logging to Things 3 & SCC', category: 'system' },
    { name: 'post-mortem', emoji: '🔬', description: 'Systematic error analysis & documentation', category: 'system' },
    { name: 'screenshot-to-action', emoji: '📸', description: 'Process screenshots into actionable tasks', category: 'automation' },
    { name: 'auto-skill-creator', emoji: '🧬', description: 'Automatically generate new skills', category: 'system' },
    { name: 'document-creator', emoji: '📄', description: 'Professional document generation', category: 'content' },
    { name: 'qa-check', emoji: '✅', description: 'Quality assurance checks', category: 'system' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function AgentHub() {
    const [gatewayStatus, setGatewayStatus] = useState<'online' | 'offline' | 'checking'>('checking');
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
    const [conversations, setConversations] = useState<ConversationPreview[]>([]);
    const [skillFilter, setSkillFilter] = useState<string>('all');

    const checkGatewayStatus = useCallback(async () => {
        try {
            // Try to reach OpenClaw gateway health endpoint
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('http://localhost:18789/health', { signal: controller.signal });
            clearTimeout(timeout);
            setGatewayStatus(res.ok ? 'online' : 'offline');
        } catch {
            setGatewayStatus('offline');
        }
    }, []);

    const fetchActiveTasks = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/activities?limit=20&severity=info`);
            if (!res.ok) return;
            const data = await res.json();

            // Extract agent activity from recent activities
            const agentMap = new Map<string, AgentInfo>();
            for (const activity of data.activities || []) {
                const agentId = activity.agent || 'unknown';
                if (!agentMap.has(agentId) && agentId !== 'unknown') {
                    agentMap.set(agentId, {
                        id: agentId,
                        name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
                        status: 'online',
                        lastSeen: activity.created_at,
                        currentTask: activity.event_type,
                    });
                }
            }
            setAgents(Array.from(agentMap.values()).slice(0, 6));
        } catch {
            // Silently fail — we'll show empty state
        }
    }, []);

    const fetchRunningTasks = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/tasks?status=in_progress&limit=10`);
            if (!res.ok) return;
            const data = await res.json();

            const tasks: ActiveTask[] = (data.tasks || []).map((t: Record<string, unknown>) => ({
                id: t.id as string,
                title: t.title as string || 'Untitled Task',
                agent: t.assigned_agent as string || 'unassigned',
                status: 'running' as const,
                startedAt: t.created_at as string,
                progress: undefined,
            }));
            setActiveTasks(tasks);
        } catch {
            // Silently fail
        }
    }, []);

    const fetchConversations = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/activities?limit=10&event_type=chat_message`);
            if (!res.ok) return;
            const data = await res.json();

            const convos: ConversationPreview[] = (data.activities || []).slice(0, 5).map((a: Record<string, unknown>) => ({
                id: a.id as string,
                channel: ((a.details as Record<string, unknown>)?.channel as string) || 'whatsapp',
                lastMessage: a.event_type as string,
                timestamp: a.created_at as string,
                unread: false,
            }));
            setConversations(convos);
        } catch {
            // Silently fail
        }
    }, []);

    useEffect(() => {
        checkGatewayStatus();
        fetchActiveTasks();
        fetchRunningTasks();
        fetchConversations();

        // Poll gateway status every 30s
        const interval = setInterval(checkGatewayStatus, 30000);
        return () => clearInterval(interval);
    }, [checkGatewayStatus, fetchActiveTasks, fetchRunningTasks, fetchConversations]);

    const filteredSkills = skillFilter === 'all'
        ? SKILLS
        : SKILLS.filter(s => s.category === skillFilter);

    const categories = ['all', 'search', 'automation', 'content', 'monitor', 'system'];

    const formatTimeAgo = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    return (
        <div className="agent-hub">
            {/* Gateway Status Banner */}
            <div className={`gateway-status-banner gateway-${gatewayStatus}`}>
                <div className="gateway-indicator">
                    <span className={`status-dot status-${gatewayStatus}`} />
                    <span className="gateway-label">
                        {gatewayStatus === 'checking' ? 'Checking gateway...'
                            : gatewayStatus === 'online' ? 'Alex Gateway Online'
                                : 'Alex Gateway Offline'}
                    </span>
                </div>
                <span className="gateway-endpoint">localhost:18789</span>
            </div>

            <div className="agent-hub-grid">
                {/* Active Agents */}
                <div className="panel agent-panel">
                    <h2>Active Agents</h2>
                    {agents.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-icon">🤖</span>
                            <p>No recent agent activity</p>
                        </div>
                    ) : (
                        <div className="agent-cards">
                            {agents.map(agent => (
                                <div key={agent.id} className={`agent-card agent-${agent.status}`}>
                                    <div className="agent-card-header">
                                        <span className={`status-dot status-${agent.status}`} />
                                        <span className="agent-name">{agent.name}</span>
                                    </div>
                                    <div className="agent-card-meta">
                                        <span className="agent-last-seen">{formatTimeAgo(agent.lastSeen)}</span>
                                        {agent.currentTask && (
                                            <span className="agent-task-badge">{agent.currentTask}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Active Tasks */}
                <div className="panel tasks-live-panel">
                    <h2>Live Tasks</h2>
                    {activeTasks.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-icon">⏳</span>
                            <p>No tasks running</p>
                        </div>
                    ) : (
                        <div className="live-task-list">
                            {activeTasks.map(task => (
                                <div key={task.id} className="live-task-row">
                                    <div className="live-task-info">
                                        <span className="live-task-title">{task.title}</span>
                                        <span className="live-task-agent">→ {task.agent}</span>
                                    </div>
                                    <div className="live-task-status">
                                        <span className={`task-status-badge status-${task.status}`}>
                                            {task.status === 'running' ? '⚡ Running' : '⏸ Waiting'}
                                        </span>
                                        <span className="live-task-time">{formatTimeAgo(task.startedAt)}</span>
                                    </div>
                                    {task.progress !== undefined && (
                                        <div className="live-task-progress">
                                            <div className="progress-bar">
                                                <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Recent Conversations */}
                <div className="panel conversations-panel">
                    <h2>Recent Conversations</h2>
                    {conversations.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-icon">💬</span>
                            <p>No recent conversations</p>
                        </div>
                    ) : (
                        <div className="conversation-list">
                            {conversations.map(convo => (
                                <div key={convo.id} className={`conversation-row ${convo.unread ? 'unread' : ''}`}>
                                    <span className="channel-icon">
                                        {convo.channel === 'whatsapp' ? '📱' : convo.channel === 'telegram' ? '✈️' : '💬'}
                                    </span>
                                    <div className="conversation-content">
                                        <span className="conversation-message">{convo.lastMessage}</span>
                                        <span className="conversation-time">{formatTimeAgo(convo.timestamp)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Skills Inventory */}
                <div className="panel skills-panel">
                    <h2>Skills Inventory</h2>
                    <div className="skill-filters">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                className={`skill-filter-btn ${skillFilter === cat ? 'active' : ''}`}
                                onClick={() => setSkillFilter(cat)}
                            >
                                {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </button>
                        ))}
                    </div>
                    <div className="skills-grid">
                        {filteredSkills.map(skill => (
                            <div key={skill.name} className="skill-card">
                                <span className="skill-emoji">{skill.emoji}</span>
                                <div className="skill-info">
                                    <span className="skill-name">{skill.name}</span>
                                    <span className="skill-desc">{skill.description}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="skills-count">
                        {filteredSkills.length} skill{filteredSkills.length !== 1 ? 's' : ''}
                        {skillFilter !== 'all' ? ` in ${skillFilter}` : ' total'}
                    </div>
                </div>
            </div>
        </div>
    );
}
