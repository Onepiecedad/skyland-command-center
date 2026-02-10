import { useState, useEffect, useCallback, useMemo } from 'react';
import { useGateway } from '../gateway/useGateway';
import allSkills from '../data/skills.json';

// ============================================================================
// Types
// ============================================================================

interface SkillEntry {
    name: string;
    emoji: string;
    description: string;
    category: string;
    source: string;
}

interface ActiveTask {
    id: string;
    title: string;
    agent: string;
    status: 'running' | 'waiting';
    startedAt: string;
    progress?: number;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Neon accent per category
const CATEGORY_COLORS: Record<string, string> = {
    search: '10,132,255',       // blue
    automation: '48,209,88',    // green
    content: '191,90,242',      // purple
    monitor: '255,159,10',      // amber
    system: '94,92,230',        // indigo
};

// ============================================================================
// Component
// ============================================================================

export function AgentHub() {
    const gateway = useGateway('agent:skyland:main');
    const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
    const [skillFilter, setSkillFilter] = useState<string>('all');
    const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Cast imported JSON
    const skills = allSkills as SkillEntry[];

    // Alex status from gateway
    const alexOnline = gateway.status === 'connected';
    const alexState = gateway.alexState;

    // --- Fetch tasks from SCC backend ---
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
            }));
            setActiveTasks(tasks);
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        fetchRunningTasks();
        const interval = setInterval(fetchRunningTasks, 30000);
        return () => clearInterval(interval);
    }, [fetchRunningTasks]);

    // --- Skills filtering + search ---
    const filteredSkills = useMemo(() => {
        let result = skills;
        if (skillFilter !== 'all') {
            result = result.filter(s => s.category === skillFilter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q)
            );
        }
        return result;
    }, [skills, skillFilter, searchQuery]);

    const categories = ['all', 'search', 'automation', 'content', 'monitor', 'system'];

    const formatTimeAgo = useCallback((dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }, []);

    // Status banner config
    const statusConfig = {
        connected: { label: 'Alex Gateway Online', class: 'online', dot: 'status-online' },
        connecting: { label: 'Connecting to Gateway…', class: 'checking', dot: 'status-checking' },
        disconnected: { label: 'Alex Gateway Offline', class: 'offline', dot: 'status-offline' },
    };
    const sc = statusConfig[gateway.status];

    // Alex state config
    const stateConfig: Record<string, { label: string; class: string; icon: string }> = {
        idle: { label: 'Idle — ready for tasks', class: 'state-idle', icon: '😴' },
        thinking: { label: 'Thinking…', class: 'state-thinking', icon: '🧠' },
        executing: { label: 'Running tools…', class: 'state-executing', icon: '⚡' },
        stuck: { label: 'Stuck — needs help', class: 'state-stuck', icon: '🚨' },
        unknown: { label: 'Unknown', class: 'state-unknown', icon: '❓' },
    };
    const alexSc = stateConfig[alexState] || stateConfig.unknown;

    return (
        <div className="agent-hub">
            {/* Gateway Status Banner */}
            <div className={`gateway-status-banner gateway-${sc.class}`}>
                <div className="gateway-indicator">
                    <span className={`status-dot ${sc.dot}`} />
                    <span className="gateway-label">{sc.label}</span>
                </div>
                <span className="gateway-endpoint">ws://127.0.0.1:18789</span>
            </div>

            <div className="agent-hub-grid">
                {/* Alex Status Card */}
                <div className="panel alex-status-panel">
                    <h2>⚡ Alex</h2>
                    <div className={`alex-hero-status ${alexSc.class}`}>
                        <span className="alex-hero-icon">{alexSc.icon}</span>
                        <div className="alex-hero-info">
                            <span className="alex-hero-label">{alexSc.label}</span>
                            <span className={`alex-hero-dot ${alexOnline ? 'online' : 'offline'}`} />
                        </div>
                    </div>

                    {/* Connected Nodes */}
                    <div className="nodes-section">
                        <h3>Connected Nodes</h3>
                        {gateway.nodes.length === 0 ? (
                            <p className="empty-state-small">No nodes connected</p>
                        ) : (
                            <div className="node-list">
                                {gateway.nodes.map(node => (
                                    <div key={node.id} className={`node-card ${node.connected ? 'connected' : ''}`}>
                                        <span className={`status-dot status-${node.connected ? 'online' : 'offline'}`} />
                                        <span className="node-name">{node.name || node.id}</span>
                                        <span className="node-platform">{node.platform}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Skills Inventory — Premium Cards */}
                <div className="panel skills-panel">
                    <div className="skills-header">
                        <h2>Skills Inventory</h2>
                        <span className="skills-count-badge">{skills.length}</span>
                    </div>

                    <div className="skills-toolbar">
                        <div className="skill-filters">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    className={`skill-filter-btn ${skillFilter === cat ? 'active' : ''}`}
                                    onClick={() => setSkillFilter(cat)}
                                    style={
                                        skillFilter === cat && cat !== 'all'
                                            ? { '--cat-rgb': CATEGORY_COLORS[cat] } as React.CSSProperties
                                            : undefined
                                    }
                                >
                                    {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                                </button>
                            ))}
                        </div>
                        <input
                            className="skill-search"
                            type="text"
                            placeholder="Search skills…"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="skills-grid">
                        {filteredSkills.map(skill => {
                            const rgb = CATEGORY_COLORS[skill.category] || '94,92,230';
                            return (
                                <div
                                    key={skill.name}
                                    className="skill-card"
                                    style={{ '--neon-rgb': rgb } as React.CSSProperties}
                                    onClick={() => setSelectedSkill(skill)}
                                >
                                    <div className="skill-card-glow" />
                                    <span className="skill-emoji">{skill.emoji}</span>
                                    <span className="skill-name">{skill.name}</span>
                                    <span className="skill-desc">{skill.description}</span>
                                    <span
                                        className="skill-category-dot"
                                        style={{ background: `rgb(${rgb})` }}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <div className="skills-footer">
                        {filteredSkills.length} of {skills.length} skill{skills.length !== 1 ? 's' : ''}
                        {skillFilter !== 'all' && ` in ${skillFilter}`}
                        {searchQuery && ` matching "${searchQuery}"`}
                    </div>
                </div>
            </div>

            {/* ─── Skill Detail Modal ─── */}
            {selectedSkill && (
                <div className="skill-modal-overlay" onClick={() => setSelectedSkill(null)}>
                    <div
                        className="skill-modal"
                        style={{ '--neon-rgb': CATEGORY_COLORS[selectedSkill.category] || '94,92,230' } as React.CSSProperties}
                        onClick={e => e.stopPropagation()}
                    >
                        <button className="skill-modal-close" onClick={() => setSelectedSkill(null)}>✕</button>

                        <div className="skill-modal-header">
                            <span className="skill-modal-emoji">{selectedSkill.emoji}</span>
                            <div>
                                <h2 className="skill-modal-title">{selectedSkill.name}</h2>
                                <span className="skill-modal-category">{selectedSkill.category}</span>
                            </div>
                        </div>

                        <div className="skill-modal-section">
                            <h3>Description</h3>
                            <p>{selectedSkill.description}</p>
                        </div>

                        <div className="skill-modal-section">
                            <h3>Details</h3>
                            <div className="skill-modal-meta">
                                <div className="meta-row">
                                    <span className="meta-label">Source</span>
                                    <code>{selectedSkill.source === 'clawd' ? '~/clawd/skills/' : '~/.openclaw/skills/'}{selectedSkill.name}/</code>
                                </div>
                                <div className="meta-row">
                                    <span className="meta-label">Category</span>
                                    <span className="skill-modal-cat-badge" style={{ background: `rgba(${CATEGORY_COLORS[selectedSkill.category] || '94,92,230'}, 0.15)`, color: `rgb(${CATEGORY_COLORS[selectedSkill.category] || '94,92,230'})` }}>
                                        {selectedSkill.category}
                                    </span>
                                </div>
                                <div className="meta-row">
                                    <span className="meta-label">Config File</span>
                                    <code>SKILL.md</code>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
