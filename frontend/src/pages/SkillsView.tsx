import { useState, useEffect, useMemo } from 'react';
import { Search, RefreshCw, Package, Code, Puzzle } from 'lucide-react';
import { fetchSkills, fetchSkillDetail, type Skill } from '../api';
import { SkillCard } from '../components/system/SkillCard';

export function SkillsView() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'scripts' | 'docs'>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSkills = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchSkills();
            setSkills(data.skills);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte ladda skills');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSkills();
    }, []);

    const filteredSkills = useMemo(() => {
        let result = skills;

        if (search) {
            const q = search.toLowerCase();
            result = result.filter(s =>
                s.skill_name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q)
            );
        }

        if (filter === 'scripts') {
            result = result.filter(s => s.has_scripts);
        } else if (filter === 'docs') {
            result = result.filter(s => !!s.homepage);
        }

        return result;
    }, [skills, search, filter]);

    const handleViewDetail = async (name: string) => {
        try {
            const data = await fetchSkillDetail(name);
            setSelectedSkill(data.skill);
        } catch {
            // Ignore detail errors silently
        }
    };

    // Stats
    const stats = useMemo(() => ({
        total: skills.length,
        withScripts: skills.filter(s => s.has_scripts).length,
        withDocs: skills.filter(s => s.homepage).length,
    }), [skills]);

    return (
        <div className="skills-view">
            {/* Header */}
            <div className="skills-header">
                <div className="skills-header-left">
                    <h2 className="skills-title">
                        <span className="skills-title-glow">🧩</span>
                        Skill Registry
                    </h2>
                    <p className="skills-subtitle">
                        Installerade skills i Alex/Clawdbot
                    </p>
                </div>
                <button className="skills-refresh-btn" onClick={loadSkills} disabled={loading}>
                    <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                    Uppdatera
                </button>
            </div>

            {/* Stats bar */}
            <div className="skills-stats">
                <div className="skills-stat">
                    <Package size={14} />
                    <span>{stats.total} skills</span>
                </div>
                <div className="skills-stat">
                    <Code size={14} />
                    <span>{stats.withScripts} med scripts</span>
                </div>
                <div className="skills-stat">
                    <Puzzle size={14} />
                    <span>{stats.withDocs} med docs</span>
                </div>
            </div>

            {/* Search + Filter */}
            <div className="skills-toolbar">
                <div className="skills-search-wrap">
                    <Search size={14} className="skills-search-icon" />
                    <input
                        type="text"
                        className="skills-search"
                        placeholder="Sök skills..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="skills-filter-group">
                    {(['all', 'scripts', 'docs'] as const).map((f) => (
                        <button
                            key={f}
                            className={`skills-filter-btn ${filter === f ? 'active' : ''}`}
                            onClick={() => setFilter(f)}
                        >
                            {f === 'all' ? 'Alla' : f === 'scripts' ? 'Med scripts' : 'Med docs'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Error state */}
            {error && (
                <div className="skills-error">
                    ⚠️ {error}
                </div>
            )}

            {/* Grid */}
            <div className="skills-grid">
                {loading && skills.length === 0 ? (
                    <div className="skills-loading">Laddar skills...</div>
                ) : filteredSkills.length === 0 ? (
                    <div className="skills-empty">Inga skills matchar sökningen</div>
                ) : (
                    filteredSkills.map((skill) => (
                        <SkillCard
                            key={skill.skill_name}
                            skill={skill}
                            onViewDetail={handleViewDetail}
                        />
                    ))
                )}
            </div>

            {/* Detail Modal */}
            {selectedSkill && (
                <div className="skills-modal-backdrop" onClick={() => setSelectedSkill(null)}>
                    <div className="skills-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="skills-modal-header">
                            <span className="skills-modal-emoji">{selectedSkill.emoji || '🧩'}</span>
                            <h3>{selectedSkill.skill_name}</h3>
                            <button className="skills-modal-close" onClick={() => setSelectedSkill(null)}>✕</button>
                        </div>
                        <p className="skills-modal-desc">{selectedSkill.description}</p>

                        {selectedSkill.homepage && (
                            <a href={selectedSkill.homepage} className="skills-modal-link" target="_blank" rel="noopener noreferrer">
                                🔗 {selectedSkill.homepage}
                            </a>
                        )}

                        {selectedSkill.files && selectedSkill.files.length > 0 && (
                            <div className="skills-modal-files">
                                <h4>Filer</h4>
                                <ul>
                                    {selectedSkill.files.map((f) => (
                                        <li key={f.name}>
                                            {f.is_directory ? '📁' : '📄'} {f.name}
                                            <span className="skills-modal-file-size">
                                                {f.is_directory ? '' : `${(f.size / 1024).toFixed(1)} KB`}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {selectedSkill.readme && (
                            <div className="skills-modal-readme">
                                <h4>README</h4>
                                <pre>{selectedSkill.readme}</pre>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
