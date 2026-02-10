import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { scanSkills, SKILLS_DIR, parseFrontmatter } from './skillRegistry';

const router = Router();

// ============================================================================
// Types
// ============================================================================
interface SkillMatch {
    skill_name: string;
    description: string;
    relevance_score: number;
    status: string;
    enabled: boolean;
    has_scripts: boolean;
    tags: string[];
    path: string;
}

interface ValidationResult {
    skill_name: string;
    usable: boolean;
    checks: { name: string; passed: boolean; detail: string }[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Simple keyword-based relevance scoring */
function scoreRelevance(task: string, skillName: string, description: string, tags: string[]): number {
    const taskLower = task.toLowerCase();
    const words = taskLower.split(/\s+/).filter(w => w.length > 2);
    let score = 0;

    // Exact skill name match
    if (taskLower.includes(skillName.toLowerCase())) {
        score += 10;
    }

    // Word matches in description
    const descLower = description.toLowerCase();
    for (const word of words) {
        if (descLower.includes(word)) score += 2;
        if (skillName.toLowerCase().includes(word)) score += 3;
    }

    // Tag matches
    for (const tag of tags) {
        if (taskLower.includes(tag)) score += 5;
        for (const word of words) {
            if (tag.includes(word)) score += 2;
        }
    }

    return score;
}

// ============================================================================
// POST /api/v1/skills/check — Find matching skills for a task
// ============================================================================
router.post('/check', (req: Request, res: Response) => {
    try {
        const { task, agent_id } = req.body as { task?: string; agent_id?: string };

        if (!task || typeof task !== 'string') {
            return res.status(400).json({ error: 'Missing required field: task (string)' });
        }

        const skills = scanSkills(SKILLS_DIR);

        // Score and rank skills
        const matches: SkillMatch[] = skills
            .map(skill => ({
                skill_name: skill.skill_name,
                description: skill.description,
                relevance_score: scoreRelevance(task, skill.skill_name, skill.description, skill.tags || []),
                status: skill.status,
                enabled: skill.enabled,
                has_scripts: skill.has_scripts,
                tags: skill.tags || [],
                path: skill.path,
            }))
            .filter(m => m.relevance_score > 0)
            .sort((a, b) => b.relevance_score - a.relevance_score)
            .slice(0, 10); // Top 10 matches

        return res.json({
            task,
            agent_id: agent_id || 'unknown',
            matches,
            total_skills: skills.length,
            matched_count: matches.length,
        });
    } catch (err) {
        console.error('Error checking skills:', err);
        return res.status(500).json({ error: 'Failed to check skills' });
    }
});

// ============================================================================
// GET /api/v1/skills/:name/validate — Check if skill is usable
// ============================================================================
router.get('/:name/validate', (req: Request, res: Response) => {
    try {
        const name = req.params.name as string;
        const skillPath = path.join(SKILLS_DIR, name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        if (!fs.existsSync(skillPath)) {
            return res.status(404).json({ error: `Skill '${name}' not found` });
        }

        const checks: ValidationResult['checks'] = [];

        // Check 1: SKILL.md exists
        const hasSkillMd = fs.existsSync(skillMdPath);
        checks.push({
            name: 'skill_md_exists',
            passed: hasSkillMd,
            detail: hasSkillMd ? 'SKILL.md found' : 'SKILL.md missing',
        });

        // Check 2: Has valid metadata
        if (hasSkillMd) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const frontmatter = parseFrontmatter(content);
            const hasMetadata = Object.keys(frontmatter).length > 0;
            checks.push({
                name: 'valid_metadata',
                passed: hasMetadata,
                detail: hasMetadata ? `Keys: ${Object.keys(frontmatter).join(', ')}` : 'No frontmatter',
            });
        }

        // Check 3: Has executable files
        let hasScripts = false;
        let scriptFiles: string[] = [];
        try {
            const allFiles = fs.readdirSync(skillPath);
            scriptFiles = allFiles.filter(f =>
                f.endsWith('.sh') || f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.ts')
            );
            hasScripts = scriptFiles.length > 0;
        } catch {
            // ignore
        }
        checks.push({
            name: 'has_executables',
            passed: hasScripts,
            detail: hasScripts ? `Scripts: ${scriptFiles.join(', ')}` : 'No executable scripts',
        });

        // Check 4: Skill status (enabled/disabled)
        const statusPath = path.join(skillPath, '.skill-status.json');
        let enabled = true;
        if (fs.existsSync(statusPath)) {
            try {
                const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
                enabled = status.enabled !== false;
            } catch {
                // ignore
            }
        }
        checks.push({
            name: 'enabled',
            passed: enabled,
            detail: enabled ? 'Skill is enabled' : 'Skill is disabled',
        });

        const usable = checks.every(c => c.passed);

        return res.json({
            skill_name: name,
            usable,
            checks,
        } as ValidationResult);
    } catch (err) {
        console.error('Error validating skill:', err);
        return res.status(500).json({ error: 'Failed to validate skill' });
    }
});

export default router;
