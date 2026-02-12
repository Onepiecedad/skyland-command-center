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
  Activity,
  Layers,
  ArrowUpRight,
  Heart,
  Users,
  User,
  Database,
  Plug,
  ChevronDown,
} from 'lucide-react';
import { AlexChat } from '../components/AlexChat';
import { ThreadSidebar } from '../components/chat/ThreadSidebar';
import { ThreadMemoryPanel } from '../components/chat/ThreadMemoryPanel';
import { useGateway } from '../gateway/useGateway';

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

const SKILLS_API = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1/skills`
  : 'http://localhost:3001/api/v1/skills';

export default function AlexView() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  /* ─── Gateway (lifted so sidebar threads can share state) ─── */
  const gateway = useGateway('agent:skyland:main');

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

  const handleTaskCreated = useCallback(() => {
    console.log('[AlexView] Task created');
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
            <span className="alex-profile-role">AI Assistant</span>
          </div>
          <div className="alex-profile-stats">
            <div className="alex-stat">
              <Activity size={10} />
              <span>{gateway.status === 'connected' ? 'Online' : 'Offline'}</span>
            </div>
            <div className="alex-stat">
              <Layers size={10} />
              <span>{skills.length} skills</span>
            </div>
          </div>
        </div>

        {/* ── Collapsible Sidebar Sections ── */}
        <nav className="alex-sidebar-sections">
          {/* ── Konversationer Section ── */}
          <div className="alex-section">
            <button
              className={`alex-section-header ${collapsedSections.has('threads') ? 'collapsed' : ''}`}
              onClick={() => toggleSection('threads')}
            >
              <ChevronDown size={14} className="alex-section-chevron" />
              <span>Konversationer</span>
            </button>
            {!collapsedSections.has('threads') && (
              <div className="alex-section-items">
                <button
                  className={`alex-section-item ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setActiveTab('chat')}
                >
                  <MessageCircle size={13} />
                  <span>Aktiv chatt</span>
                </button>
                <ThreadSidebar
                  sessions={gateway.sessions}
                  activeSessionKey={gateway.sessionKey}
                  threadPreviews={gateway.threadPreviews}
                  onSelectSession={(key) => gateway.setSessionKey(key)}
                  onNewThread={() => {
                    setActiveTab('chat');
                    gateway.createNewSession().catch(console.error);
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Uppgifter Section ── */}
          <div className="alex-section">
            <button
              className={`alex-section-header ${collapsedSections.has('tasks') ? 'collapsed' : ''}`}
              onClick={() => toggleSection('tasks')}
            >
              <ChevronDown size={14} className="alex-section-chevron" />
              <span>Uppgifter</span>
            </button>
            {!collapsedSections.has('tasks') && (
              <div className="alex-section-items">
                <button
                  className={`alex-section-item ${activeTab === 'tasks' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tasks')}
                >
                  <ListTodo size={13} />
                  <span>Aktiva uppgifter</span>
                </button>
              </div>
            )}
          </div>

          {/* ── Agent Section ── */}
          <div className="alex-section">
            <button
              className={`alex-section-header ${collapsedSections.has('agent') ? 'collapsed' : ''}`}
              onClick={() => toggleSection('agent')}
            >
              <ChevronDown size={14} className="alex-section-chevron" />
              <span>Agent</span>
            </button>
            {!collapsedSections.has('agent') && (
              <div className="alex-section-items">
                <button
                  className={`alex-section-item ${activeTab === 'skills' ? 'active' : ''}`}
                  onClick={() => setActiveTab('skills')}
                >
                  <Puzzle size={13} />
                  <span>Capabilities</span>
                  <span className="alex-section-count">{skills.length}</span>
                </button>
                <button
                  className={`alex-section-item ${activeTab === 'costs' ? 'active' : ''}`}
                  onClick={() => setActiveTab('costs')}
                >
                  <Wallet size={13} />
                  <span>Kostnader</span>
                </button>
              </div>
            )}
          </div>

          {/* ── Minne Section ── */}
          <div className="alex-section">
            <button
              className={`alex-section-header ${collapsedSections.has('memory') ? 'collapsed' : ''}`}
              onClick={() => toggleSection('memory')}
            >
              <ChevronDown size={14} className="alex-section-chevron" />
              <span>Alex Minne</span>
            </button>
            {!collapsedSections.has('memory') && (
              <div className="alex-section-items">
                <ThreadMemoryPanel
                  memoryEntries={gateway.memoryEntries}
                  onSearch={gateway.searchMemory}
                />
              </div>
            )}
          </div>

        </nav>
      </aside>

      {/* ─── Main Content Area ─── */}
      <section className="alex-content">
        {activeTab === 'chat' && (
          <AlexChat onTaskCreated={handleTaskCreated} gateway={gateway} />
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
