import { useState, useCallback, useEffect } from 'react';
import {
    MessageCircle,
    ListTodo,
    Puzzle,
    Wallet,
    Zap,
    Clock,
    Search,
    Globe,
    Bot,
    Shield,
    BarChart3,
    FileText,
    Megaphone,
    X,
    Cpu,
    Activity,
    Layers,
    ArrowUpRight,
    Heart,
    Users,
    User,
    Database,
    Plug,
} from 'lucide-react';
import { MasterBrainChat } from '../components/MasterBrainChat';

/* ─── Types ─── */
interface Skill {
    id: string;
    name: string;
    description: string;
    category: 'search' | 'automation' | 'content' | 'monitor' | 'system' | 'data' | 'integration';
    source?: 'workspace' | 'standalone' | 'subagent' | 'mcp';
}

interface RoleFile {
    key: string;
    label: string;
    description: string;
    icon: string;
    filename: string;
    content: string | null;
    size?: number;
    modified?: string;
    error?: string;
}

type SidebarTab = 'chat' | 'tasks' | 'skills' | 'costs';

const ROLE_ICON_MAP: Record<string, React.ReactNode> = {
    user: <User size={14} />,
    heart: <Heart size={14} />,
    users: <Users size={14} />,
    shield: <Shield size={14} />,
    activity: <Activity size={14} />,
};

/* ─── Config ─── */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    search: <Globe size={14} />,
    automation: <Zap size={14} />,
    content: <FileText size={14} />,
    monitor: <BarChart3 size={14} />,
    system: <Shield size={14} />,
    data: <Database size={14} />,
    integration: <Plug size={14} />,
};

const CATEGORY_LABELS: Record<string, string> = {
    search: 'Sök & Research',
    automation: 'Automation',
    content: 'Innehåll',
    monitor: 'Övervakning',
    system: 'System',
    data: 'Data & Lagring',
    integration: 'Integrationer',
};

type SourceFilter = 'all' | 'skills' | 'agents' | 'mcp';

const SIDEBAR_TABS: { key: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { key: 'chat', icon: <MessageCircle size={15} />, label: 'Chat' },
    { key: 'tasks', icon: <ListTodo size={15} />, label: 'Uppgifter' },
    { key: 'skills', icon: <Puzzle size={15} />, label: 'Capabilities' },
    { key: 'costs', icon: <Wallet size={15} />, label: 'Kostnader' },
];

const SKILLS_API = import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api/v1/skills`
    : 'http://localhost:3001/api/v1/skills';

interface Props {
    onTaskCreated: () => void;
}

export function AlexView({ onTaskCreated }: Props) {
    const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
    const [skillSearch, setSkillSearch] = useState('');
    const [skills, setSkills] = useState<Skill[]>([]);
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

    /* ─── Fetch real skills from backend ─── */
    useEffect(() => {
        fetch(SKILLS_API)
            .then(r => r.json())
            .then(data => setSkills(data.skills || []))
            .catch(err => console.error('Failed to fetch skills:', err));
    }, []);

    /* ─── Role Inspector State ─── */
    const [roleOpen, setRoleOpen] = useState(false);
    const [roleFiles, setRoleFiles] = useState<RoleFile[]>([]);
    const [roleTab, setRoleTab] = useState('identity');
    const [roleLoading, setRoleLoading] = useState(false);

    const fetchRoleFiles = useCallback(async () => {
        setRoleLoading(true);
        try {
            const res = await fetch('/api/v1/alex/role-files');
            const data = await res.json();
            setRoleFiles(data.files || []);
        } catch (err) {
            console.error('Failed to fetch role files:', err);
        } finally {
            setRoleLoading(false);
        }
    }, []);

    useEffect(() => {
        if (roleOpen && roleFiles.length === 0) {
            fetchRoleFiles();
        }
    }, [roleOpen, roleFiles.length, fetchRoleFiles]);

    /* ─── Derived: filter + group ─── */
    const skillsBySource = (filter: SourceFilter) => {
        if (filter === 'skills') return skills.filter(s => s.source === 'workspace' || s.source === 'standalone');
        if (filter === 'agents') return skills.filter(s => s.source === 'subagent');
        if (filter === 'mcp') return skills.filter(s => s.source === 'mcp');
        return skills;
    };

    const sourceCounts = {
        all: skills.length,
        skills: skills.filter(s => s.source === 'workspace' || s.source === 'standalone').length,
        agents: skills.filter(s => s.source === 'subagent').length,
        mcp: skills.filter(s => s.source === 'mcp').length,
    };

    const filteredSkills = skillsBySource(sourceFilter).filter(s =>
        (s.name || '').toLowerCase().includes(skillSearch.toLowerCase()) ||
        (s.description || '').toLowerCase().includes(skillSearch.toLowerCase())
    );

    // Group by category for display
    const categoryGroups = Object.keys(CATEGORY_LABELS)
        .map(cat => ({
            key: cat,
            label: CATEGORY_LABELS[cat],
            icon: CATEGORY_ICONS[cat],
            items: filteredSkills.filter(s => s.category === cat),
        }))
        .filter(g => g.items.length > 0);

    const handleSkillClick = useCallback((skill: Skill) => {
        setSelectedSkill(prev => prev?.id === skill.id ? null : skill);
    }, []);

    return (
        <div className="alex-view">
            {/* ─── Left Sidebar ─── */}
            <aside className="alex-sidebar">
                {/* Alex Profile Card */}
                <div className="alex-profile-card">
                    <button
                        className="alex-profile-avatar alex-role-trigger"
                        onClick={() => setRoleOpen(true)}
                        title="Visa rollfiler"
                    >
                        <div className="alex-avatar-ring" />
                        <Bot size={22} strokeWidth={1.8} />
                    </button>
                    <div className="alex-profile-info">
                        <span className="alex-profile-name">Alex</span>
                        <span className="alex-profile-role">AI Assistent</span>
                    </div>
                    <div className="alex-profile-stats">
                        <div className="alex-stat">
                            <Cpu size={11} />
                            <span>GPT-4o</span>
                        </div>
                        <div className="alex-stat">
                            <Activity size={11} />
                            <span>Online</span>
                        </div>
                        <div className="alex-stat">
                            <Layers size={11} />
                            <span>{skills.length} skills</span>
                        </div>
                    </div>
                </div>

                {/* Sidebar Tabs */}
                <nav className="alex-nav">
                    {SIDEBAR_TABS.map(tab => (
                        <button
                            key={tab.key}
                            className={`alex-nav-item ${activeTab === tab.key ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            <span className="alex-nav-icon">{tab.icon}</span>
                            <span className="alex-nav-label">{tab.label}</span>
                            {activeTab === tab.key && <span className="alex-nav-indicator" />}
                        </button>
                    ))}
                </nav>
            </aside>

            {/* ─── Main Content Area ─── */}
            <section className="alex-content">
                {activeTab === 'chat' && (
                    <MasterBrainChat onTaskCreated={onTaskCreated} />
                )}

                {activeTab === 'tasks' && (
                    <div className="alex-panel-glass">
                        <div className="alex-panel-header">
                            <ListTodo size={16} />
                            <span>Aktiva uppgifter</span>
                        </div>
                        <div className="alex-panel-empty">
                            <Clock size={24} strokeWidth={1.5} />
                            <p>Inga aktiva uppgifter just nu</p>
                        </div>
                    </div>
                )}

                {activeTab === 'skills' && (
                    <div className="alex-skills-panel">
                        {/* ─── Segmented Control ─── */}
                        <div className="skills-segment-bar">
                            {(['all', 'skills', 'agents', 'mcp'] as SourceFilter[]).map(seg => (
                                <button
                                    key={seg}
                                    className={`skills-segment-btn ${sourceFilter === seg ? 'active' : ''}`}
                                    onClick={() => setSourceFilter(seg)}
                                >
                                    {seg === 'all' ? 'Alla' : seg === 'skills' ? 'Skills' : seg === 'agents' ? 'Agenter' : 'MCP'}
                                    <span className="skills-segment-count">{sourceCounts[seg]}</span>
                                </button>
                            ))}
                        </div>

                        {/* ─── Search ─── */}
                        <div className="alex-skills-search">
                            <Search size={14} />
                            <input
                                type="text"
                                placeholder="Sök capabilities..."
                                value={skillSearch}
                                onChange={e => setSkillSearch(e.target.value)}
                            />
                        </div>

                        {/* ─── Card Grid ─── */}
                        <div className="skills-card-scroll">
                            {categoryGroups.map(group => (
                                <div key={group.key} className="skills-category-section">
                                    <div className="skills-category-label">
                                        {group.icon}
                                        <span>{group.label}</span>
                                        <span className="skills-category-count">{group.items.length}</span>
                                    </div>
                                    <div className="skills-card-grid">
                                        {group.items.map(skill => (
                                            <button
                                                key={skill.id}
                                                className={`skills-card ${selectedSkill?.id === skill.id ? 'active' : ''}`}
                                                onClick={() => handleSkillClick(skill)}
                                            >
                                                <div className="skills-card-icon">
                                                    {CATEGORY_ICONS[skill.category] || <Puzzle size={14} />}
                                                </div>
                                                <div className="skills-card-body">
                                                    <span className="skills-card-name">{skill.name}</span>
                                                    <span className="skills-card-desc">{skill.description}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {filteredSkills.length === 0 && (
                                <div className="alex-panel-empty">
                                    <Search size={24} strokeWidth={1.5} />
                                    <p>Inga resultat</p>
                                </div>
                            )}
                        </div>

                        {/* ─── Skill Detail Overlay ─── */}
                        {selectedSkill && (
                            <div className="alex-skill-detail-overlay" onClick={() => setSelectedSkill(null)}>
                                <div
                                    className="alex-skill-detail"
                                    onClick={e => e.stopPropagation()}
                                >
                                    <button className="alex-skill-detail-close" onClick={() => setSelectedSkill(null)} aria-label="Stäng">
                                        <X size={16} />
                                    </button>
                                    <div className="alex-skill-detail-header">
                                        {CATEGORY_ICONS[selectedSkill.category]}
                                        <h3>{selectedSkill.name}</h3>
                                    </div>
                                    <p className="alex-skill-detail-desc">{selectedSkill.description}</p>
                                    <div className="alex-skill-detail-meta">
                                        <span className="alex-skill-detail-badge">
                                            {CATEGORY_LABELS[selectedSkill.category]}
                                        </span>
                                        {selectedSkill.source && (
                                            <span className="alex-skill-detail-badge source">
                                                {selectedSkill.source === 'subagent' ? 'Agent' : selectedSkill.source === 'mcp' ? 'MCP' : 'Skill'}
                                            </span>
                                        )}
                                    </div>
                                    <button className="alex-skill-run-btn">
                                        <ArrowUpRight size={14} />
                                        Kör
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'costs' && (
                    <div className="alex-panel-glass">
                        <div className="alex-panel-header">
                            <Wallet size={16} />
                            <span>Kostnadsöversikt</span>
                        </div>
                        <div className="alex-panel-empty">
                            <Megaphone size={24} strokeWidth={1.5} />
                            <p>Kostnadsspårning kommer snart</p>
                        </div>
                    </div>
                )}
            </section>

            {/* ─── Role Inspector Modal ─── */}
            {roleOpen && (
                <div className="role-inspector-overlay" onClick={() => setRoleOpen(false)}>
                    <div className="role-inspector" onClick={e => e.stopPropagation()}>
                        <div className="role-inspector-header">
                            <div className="role-inspector-title">
                                <Bot size={18} strokeWidth={1.8} />
                                <h2>Alex — Rollfiler</h2>
                            </div>
                            <button className="role-inspector-close" onClick={() => setRoleOpen(false)} aria-label="Stäng">
                                <X size={16} />
                            </button>
                        </div>

                        <nav className="role-inspector-tabs">
                            {roleFiles.map(f => (
                                <button
                                    key={f.key}
                                    className={`role-tab ${roleTab === f.key ? 'active' : ''}`}
                                    onClick={() => setRoleTab(f.key)}
                                >
                                    {ROLE_ICON_MAP[f.icon] || <FileText size={14} />}
                                    <span>{f.label}</span>
                                </button>
                            ))}
                        </nav>

                        <div className="role-inspector-body">
                            {roleLoading ? (
                                <div className="role-inspector-loading">
                                    <Activity size={20} className="role-spin" />
                                    <span>Laddar filer…</span>
                                </div>
                            ) : (
                                roleFiles
                                    .filter(f => f.key === roleTab)
                                    .map(f => (
                                        <div key={f.key} className="role-file-content">
                                            <div className="role-file-meta">
                                                <span className="role-file-name">{f.filename}</span>
                                                {f.size && <span className="role-file-size">{(f.size / 1024).toFixed(1)} KB</span>}
                                                {f.modified && (
                                                    <span className="role-file-date">
                                                        Ändrad {new Date(f.modified).toLocaleDateString('sv-SE')}
                                                    </span>
                                                )}
                                            </div>
                                            {f.content ? (
                                                <pre className="role-file-pre">{f.content}</pre>
                                            ) : (
                                                <p className="role-file-missing">{f.error || 'Fil saknas'}</p>
                                            )}
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
