import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// ============================================================================
// Types
// ============================================================================
interface SkillStatus {
    enabled: boolean;
    updated_at: string;
    updated_by?: string;
}

interface SkillInfo {
    skill_name: string;
    description: string;
    path: string;
    status: 'active' | 'disabled' | 'deprecated' | 'draft';
    enabled: boolean;
    homepage?: string;
    emoji?: string;
    has_scripts: boolean;
    file_count: number;
    tags?: string[];
}

interface DryRunResult {
    skill_name: string;
    valid: boolean;
    checks: { name: string; passed: boolean; detail: string }[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Parse YAML frontmatter from a SKILL.md file */
function parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const result: Record<string, unknown> = {};

    for (const line of yaml.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value: string | unknown = line.slice(colonIdx + 1).trim();

        // Try to parse JSON values (e.g. metadata field)
        if (typeof value === 'string' && value.startsWith('{')) {
            try {
                value = JSON.parse(value);
            } catch {
                // keep as string
            }
        }
        result[key] = value;
    }
    return result;
}

const STATUS_FILE = '.skill-status.json';

/** Read skill status from .skill-status.json */
function readSkillStatus(skillPath: string): SkillStatus {
    const statusPath = path.join(skillPath, STATUS_FILE);
    try {
        if (fs.existsSync(statusPath)) {
            return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        }
    } catch {
        // ignore
    }
    return { enabled: true, updated_at: new Date().toISOString() };
}

/** Write skill status to .skill-status.json */
function writeSkillStatus(skillPath: string, status: SkillStatus): void {
    const statusPath = path.join(skillPath, STATUS_FILE);
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

/** Scan a skills directory for SKILL.md files */
function scanSkills(skillsDir: string): SkillInfo[] {
    const skills: SkillInfo[] = [];

    if (!fs.existsSync(skillsDir)) {
        return skills;
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch (err) {
        console.error(`[skills] Failed to read skills directory ${skillsDir}:`, err);
        return skills;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = path.join(skillsDir, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        if (!fs.existsSync(skillMdPath)) continue;

        try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const frontmatter = parseFrontmatter(content);
            const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
            const clawdbot = metadata?.clawdbot as Record<string, unknown> | undefined;
            const skillStatus = readSkillStatus(skillPath);

            // Count files in skill directory
            let fileCount = 0;
            let hasScripts = false;
            try {
                const allFiles = fs.readdirSync(skillPath);
                fileCount = allFiles.filter(f => f !== STATUS_FILE).length;
                hasScripts = allFiles.some(f =>
                    f.endsWith('.sh') || f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.ts')
                );
            } catch {
                // ignore
            }

            // Extract tags from description or frontmatter
            const tags: string[] = [];
            const desc = (frontmatter.description as string) || '';
            if (desc.toLowerCase().includes('research')) tags.push('research');
            if (desc.toLowerCase().includes('scrape') || desc.toLowerCase().includes('scraping')) tags.push('scraping');
            if (desc.toLowerCase().includes('image') || desc.toLowerCase().includes('screenshot')) tags.push('visual');
            if (desc.toLowerCase().includes('callback') || desc.toLowerCase().includes('webhook')) tags.push('integration');
            if (desc.toLowerCase().includes('cron') || desc.toLowerCase().includes('schedule')) tags.push('automation');
            if (hasScripts) tags.push('executable');

            skills.push({
                skill_name: (frontmatter.name as string) || entry.name,
                description: desc,
                path: skillPath,
                status: skillStatus.enabled ? 'active' : 'disabled',
                enabled: skillStatus.enabled,
                homepage: frontmatter.homepage as string | undefined,
                emoji: clawdbot?.emoji as string | undefined,
                has_scripts: hasScripts,
                file_count: fileCount,
                tags,
            });
        } catch (err) {
            console.error(`Error reading skill ${entry.name}:`, err);
        }
    }

    return skills.sort((a, b) => a.skill_name.localeCompare(b.skill_name));
}

/** Perform a dry-run validation for a skill */
function dryRunSkill(skillPath: string, skillName: string): DryRunResult {
    const checks: DryRunResult['checks'] = [];

    // Check 1: SKILL.md exists
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    const hasSkillMd = fs.existsSync(skillMdPath);
    checks.push({
        name: 'SKILL.md exists',
        passed: hasSkillMd,
        detail: hasSkillMd ? 'Found SKILL.md' : 'Missing SKILL.md file',
    });

    // Check 2: Frontmatter is valid
    let frontmatter: Record<string, unknown> = {};
    if (hasSkillMd) {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        frontmatter = parseFrontmatter(content);
        const hasFrontmatter = Object.keys(frontmatter).length > 0;
        checks.push({
            name: 'Valid frontmatter',
            passed: hasFrontmatter,
            detail: hasFrontmatter
                ? `Fields: ${Object.keys(frontmatter).join(', ')}`
                : 'No YAML frontmatter found',
        });

        // Check 3: Required fields
        const hasName = !!frontmatter.name;
        const hasDescription = !!frontmatter.description;
        checks.push({
            name: 'Required fields (name, description)',
            passed: hasName && hasDescription,
            detail: `name: ${hasName ? '✓' : '✗'}, description: ${hasDescription ? '✓' : '✗'}`,
        });
    }

    // Check 4: Has executable scripts
    let hasScripts = false;
    try {
        const allFiles = fs.readdirSync(skillPath);
        hasScripts = allFiles.some(f =>
            f.endsWith('.sh') || f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.ts')
        );
    } catch {
        // ignore
    }
    checks.push({
        name: 'Has executable scripts',
        passed: hasScripts,
        detail: hasScripts ? 'Script files found' : 'No script files found (informational)',
    });

    // Check 5: Directory not empty beyond SKILL.md
    let fileCount = 0;
    try {
        fileCount = fs.readdirSync(skillPath).filter(f => f !== 'SKILL.md' && f !== STATUS_FILE).length;
    } catch {
        // ignore
    }
    checks.push({
        name: 'Has supporting files',
        passed: fileCount > 0,
        detail: `${fileCount} supporting file(s)`,
    });

    const valid = checks.filter(c => c.name !== 'Has executable scripts' && c.name !== 'Has supporting files')
        .every(c => c.passed);

    return { skill_name: skillName, valid, checks };
}

// ============================================================================
// Default skills directory — configurable via env
// ============================================================================
export const SKILLS_DIR = process.env.SKILLS_DIR ||
    path.join(
        process.env.HOME || '',
        '.gemini/antigravity/playground/inner-asteroid/clawdbot/skills'
    );

// Export helpers for use by skillChecker
export { scanSkills, parseFrontmatter, readSkillStatus };

// ============================================================================
// GET /api/v1/skills — List all skills
// ============================================================================
router.get('/', (_req: Request, res: Response) => {
    try {
        const skills = scanSkills(SKILLS_DIR);
        const enabledCount = skills.filter(s => s.enabled).length;
        return res.json({
            skills,
            count: skills.length,
            enabled_count: enabledCount,
            disabled_count: skills.length - enabledCount,
            source: SKILLS_DIR,
        });
    } catch (err) {
        console.error('Error scanning skills:', err);
        return res.status(500).json({ error: 'Failed to scan skills directory' });
    }
});

// ============================================================================
// GET /api/v1/skills/:name — Get single skill detail
// ============================================================================
router.get('/:name', (req: Request, res: Response) => {
    try {
        const name = req.params.name as string;
        const skillPath = path.join(SKILLS_DIR, name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        if (!fs.existsSync(skillMdPath)) {
            return res.status(404).json({ error: `Skill '${name}' not found` });
        }

        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const skillStatus = readSkillStatus(skillPath);

        // List all files in skill directory
        const files = fs.readdirSync(skillPath)
            .filter(f => f !== STATUS_FILE)
            .map(f => {
                const filePath = path.join(skillPath, f);
                const stat = fs.statSync(filePath);
                return {
                    name: f,
                    size: stat.size,
                    modified: stat.mtime.toISOString(),
                    is_directory: stat.isDirectory(),
                };
            });

        // Extract markdown body (after frontmatter)
        const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1].trim() : content;

        return res.json({
            skill: {
                skill_name: (frontmatter.name as string) || name,
                description: (frontmatter.description as string) || '',
                homepage: frontmatter.homepage,
                metadata: frontmatter.metadata,
                path: skillPath,
                status: skillStatus.enabled ? 'active' : 'disabled',
                enabled: skillStatus.enabled,
                readme: body,
                files,
            },
        });
    } catch (err) {
        console.error('Error fetching skill detail:', err);
        return res.status(500).json({ error: 'Failed to read skill' });
    }
});

// ============================================================================
// POST /api/v1/skills/:name/enable — Enable a skill
// ============================================================================
router.post('/:name/enable', (req: Request, res: Response) => {
    try {
        const name = req.params.name as string;
        const skillPath = path.join(SKILLS_DIR, name);

        if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
            return res.status(404).json({ error: `Skill '${name}' not found` });
        }

        const status: SkillStatus = {
            enabled: true,
            updated_at: new Date().toISOString(),
            updated_by: (req.body?.user as string) || 'system',
        };
        writeSkillStatus(skillPath, status);

        return res.json({ skill_name: name, enabled: true, updated_at: status.updated_at });
    } catch (err) {
        console.error('Error enabling skill:', err);
        return res.status(500).json({ error: 'Failed to enable skill' });
    }
});

// ============================================================================
// POST /api/v1/skills/:name/disable — Disable a skill
// ============================================================================
router.post('/:name/disable', (req: Request, res: Response) => {
    try {
        const name = req.params.name as string;
        const skillPath = path.join(SKILLS_DIR, name);

        if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
            return res.status(404).json({ error: `Skill '${name}' not found` });
        }

        const status: SkillStatus = {
            enabled: false,
            updated_at: new Date().toISOString(),
            updated_by: (req.body?.user as string) || 'system',
        };
        writeSkillStatus(skillPath, status);

        return res.json({ skill_name: name, enabled: false, updated_at: status.updated_at });
    } catch (err) {
        console.error('Error disabling skill:', err);
        return res.status(500).json({ error: 'Failed to disable skill' });
    }
});

// ============================================================================
// POST /api/v1/skills/:name/dry-run — Validate skill structure
// ============================================================================
router.post('/:name/dry-run', (req: Request, res: Response) => {
    try {
        const name = req.params.name as string;
        const skillPath = path.join(SKILLS_DIR, name);

        if (!fs.existsSync(skillPath)) {
            return res.status(404).json({ error: `Skill '${name}' not found` });
        }

        const result = dryRunSkill(skillPath, name);
        return res.json(result);
    } catch (err) {
        console.error('Error running dry-run:', err);
        return res.status(500).json({ error: 'Failed to run skill validation' });
    }
});

export default router;
