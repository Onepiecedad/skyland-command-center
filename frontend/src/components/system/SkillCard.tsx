import { useState } from 'react';
import { ExternalLink, FileText, Code, ChevronDown, ChevronUp } from 'lucide-react';
import type { Skill } from '../../api';

interface SkillCardProps {
    skill: Skill;
    onViewDetail?: (name: string) => void;
}

export function SkillCard({ skill, onViewDetail }: SkillCardProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="skill-card" onClick={() => onViewDetail?.(skill.skill_name)}>
            <div className="skill-card-header">
                <div className="skill-card-icon">
                    {skill.emoji || '🧩'}
                </div>
                <div className="skill-card-title-group">
                    <h3 className="skill-card-name">{skill.skill_name}</h3>
                    <span
                        className={`skill-card-status skill-card-status--${skill.status}`}
                    >
                        {skill.status}
                    </span>
                </div>
            </div>

            <p className="skill-card-description">
                {skill.description || 'Ingen beskrivning'}
            </p>

            <div className="skill-card-meta">
                <span className="skill-card-meta-item">
                    <FileText size={12} />
                    {skill.file_count} filer
                </span>
                {skill.has_scripts && (
                    <span className="skill-card-meta-item skill-card-meta-scripts">
                        <Code size={12} />
                        Scripts
                    </span>
                )}
                {skill.homepage && (
                    <a
                        href={skill.homepage}
                        className="skill-card-meta-item skill-card-meta-link"
                        onClick={(e) => e.stopPropagation()}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <ExternalLink size={12} />
                        Docs
                    </a>
                )}
            </div>

            {expanded && skill.readme && (
                <div className="skill-card-readme">
                    <pre>{skill.readme.slice(0, 400)}{skill.readme.length > 400 ? '...' : ''}</pre>
                </div>
            )}

            {skill.readme && (
                <button
                    className="skill-card-expand"
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(!expanded);
                    }}
                >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {expanded ? 'Dölj' : 'Visa mer'}
                </button>
            )}
        </div>
    );
}
