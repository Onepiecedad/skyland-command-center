import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const HOME = process.env.HOME || '';
const SKILLS_DIR = path.join(HOME, 'clawd', 'skills');
const AGENTS_DIR = path.join(HOME, '.openclaw', 'agents');
const MCP_CONFIG = path.join(HOME, '.gemini', 'antigravity', 'mcp_config.json');

type SkillSource = 'workspace' | 'standalone' | 'subagent' | 'mcp';

function detectCategory(name: string, desc: string): string {
    const text = `${name} ${desc}`.toLowerCase();
    if (/search|research|lookup|sök|exa|trend|qmd|prospect|find/.test(text)) return 'search';
    if (/content|document|mail|email|faktur|pipeline|writer|dm|linkedin/.test(text)) return 'content';
    if (/monitor|cost|track|uptime|status/.test(text)) return 'monitor';
    if (/automat|dispatch|check-in|cron|guard|harden|n8n|signal|hook|engineer/.test(text)) return 'automation';
    if (/data|supabase|firebase|woo|commerce|db|store/.test(text)) return 'data';
    if (/scrape|crawl|web|api|fetch/.test(text)) return 'integration';
    return 'system';
}

function prettifyName(slug: string): string {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseSkillMd(filePath: string): string {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const descMatch = content.match(/description:\s*["']?(.*?)["']?\s*$/m);
        if (descMatch && descMatch[1].trim()) return descMatch[1].trim();
        // Fallback: first non-frontmatter, non-heading line
        const bodyStart = content.indexOf('---', 3);
        if (bodyStart > 0) {
            const body = content.substring(bodyStart + 3).trim();
            const firstLine = body.split('\n').find(l => l.trim() && !l.startsWith('#'));
            if (firstLine) return firstLine.trim();
        }
    } catch { /* file not found */ }
    return '';
}

function parseLooseMd(filePath: string): string {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        return lines[0]?.trim().substring(0, 150) || '';
    } catch { return ''; }
}

// MCP server descriptions (static — these rarely change)
const MCP_DESCRIPTIONS: Record<string, string> = {
    supabase: 'PostgreSQL-databas med realtids-API, auth och storage',
    netlify: 'Deploy, hosting och serverless functions',
    n8n: 'Workflow-automation och integrationer',
    'firecrawl-mcp': 'Webbskrapning och data-extraktion',
    woocommerce: 'E-handelsplattform (WordPress)',
    firebase: 'Realtids-databas, auth och cloud functions',
    apify: 'Webskrapning och automation-actors',
    exa: 'Neural semantic search engine',
};

// Subagent descriptions (inferred from role names)
const SUBAGENT_DESCRIPTIONS: Record<string, string> = {
    'skyland': 'Huvudagent — orkestrerar alla uppgifter via SCC',
    'main': 'Primär konversationsagent med full verktygstillgång',
    'dev': 'Kodutveckling, debugging och teknisk implementation',
    'automation-engineer': 'Bygger och underhåller automatiseringsflöden',
    'content': 'Skapar textinnehåll, bloggar och nyhetsbrev',
    'deep-research': 'Djupgående research med källhänvisningar',
    'dm-writer': 'Skriver personaliserade direktmeddelanden',
    'li-verifier': 'Verifierar LinkedIn-profiler och kontaktdata',
    'n8n-admin': 'Administrerar n8n-workflows och webhooks',
    'prospect-finder': 'Hittar potentiella kunder via sökning',
    'prospect-researcher': 'Djupanalys av prospekt med ICP-matchning',
    'qa-release': 'Kvalitetskontroll och release-validering',
    'report-writer': 'Genererar strukturerade rapporter och analyser',
    'research-librarian': 'Organiserar och söker i kunskapsbas',
    'signal-hook': 'Lyssnar på triggers och dispatchar händelser',
    'strategy-analyst': 'Strategisk analys och affärsrådgivning',
};

// GET /skills - aggregate skills from workspace, subagents & MCP servers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/skills', async (_req: Request, res: Response) => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allSkills: any[] = [];

        // ── 1. Workspace skills (directories with SKILL.md) ──
        try {
            const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
            for (const e of entries) {
                if (e.isDirectory()) {
                    const desc = parseSkillMd(path.join(SKILLS_DIR, e.name, 'SKILL.md'));
                    allSkills.push({
                        id: e.name,
                        name: prettifyName(e.name),
                        description: desc || `Workspace skill: ${e.name}`,
                        category: detectCategory(e.name, desc),
                        source: 'workspace' as SkillSource,
                        path: path.join(SKILLS_DIR, e.name),
                    });
                }
            }
        } catch (err) { console.warn('Could not read skills dir:', err); }

        // ── 2. Loose .md skill files ──
        try {
            const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
            for (const e of entries) {
                if (e.isFile() && e.name.endsWith('.md')) {
                    const slug = e.name.replace('.md', '');
                    const desc = parseLooseMd(path.join(SKILLS_DIR, e.name));
                    allSkills.push({
                        id: `standalone-${slug}`,
                        name: prettifyName(slug),
                        description: desc || `Standalone skill: ${slug}`,
                        category: detectCategory(slug, desc),
                        source: 'standalone' as SkillSource,
                        path: path.join(SKILLS_DIR, e.name),
                    });
                }
            }
        } catch (err) { console.warn('Could not read loose skills:', err); }

        // ── 3. Subagents ──
        try {
            const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
            for (const a of agents) {
                if (a.isDirectory()) {
                    const desc = SUBAGENT_DESCRIPTIONS[a.name] || `Specialagent: ${prettifyName(a.name)}`;
                    allSkills.push({
                        id: `agent-${a.name}`,
                        name: prettifyName(a.name),
                        description: desc,
                        category: detectCategory(a.name, desc),
                        source: 'subagent' as SkillSource,
                        path: path.join(AGENTS_DIR, a.name),
                    });
                }
            }
        } catch (err) { console.warn('Could not read agents dir:', err); }

        // ── 4. MCP servers ──
        try {
            const raw = fs.readFileSync(MCP_CONFIG, 'utf-8');
            const mcpData = JSON.parse(raw);
            const servers = mcpData.mcpServers || {};
            for (const [name] of Object.entries(servers)) {
                const desc = MCP_DESCRIPTIONS[name] || `MCP integration: ${name}`;
                allSkills.push({
                    id: `mcp-${name}`,
                    name: prettifyName(name),
                    description: desc,
                    category: 'integration',
                    source: 'mcp' as SkillSource,
                    path: MCP_CONFIG,
                });
            }
        } catch (err) { console.warn('Could not read MCP config:', err); }

        // Sort: source priority then alphabetically
        const sourcePriority: Record<string, number> = { workspace: 0, standalone: 1, subagent: 2, mcp: 3 };
        allSkills.sort((a, b) => {
            const sp = (sourcePriority[a.source] ?? 9) - (sourcePriority[b.source] ?? 9);
            if (sp !== 0) return sp;
            return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
        });

        const summary = {
            workspace: allSkills.filter(s => s.source === 'workspace').length,
            standalone: allSkills.filter(s => s.source === 'standalone').length,
            subagent: allSkills.filter(s => s.source === 'subagent').length,
            mcp: allSkills.filter(s => s.source === 'mcp').length,
        };

        res.json({ skills: allSkills, count: allSkills.length, summary });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
        console.error('Skills endpoint error:', err);
        res.status(500).json({ error: 'Failed to read skills', details: err.message });
    }
});

export default router;
