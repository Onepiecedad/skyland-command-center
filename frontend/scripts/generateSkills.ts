#!/usr/bin/env node
/**
 * generateSkills.ts — Scan SKILL.md files and produce skills.json
 * Run: node scripts/generateSkills.ts (or ts-node / tsx)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────
const SKILL_DIRS = [
    path.join(os.homedir(), 'clawd', 'skills'),
    path.join(os.homedir(), '.openclaw', 'skills'),
];
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'skills.json');

// ── Category inference ──────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
    search: ['search', 'research', 'lookup', 'scrape', 'scraper', 'find', 'web'],
    automation: ['automat', 'calendar', 'mail', 'email', 'phone', 'voice', 'checkin', 'cron', 'schedule', 'linkedin', 'organizer', 'callback', 'walkie'],
    content: ['content', 'document', 'cover', 'image', 'social', 'card', 'tts', 'canva', 'screenshot', 'gen'],
    monitor: ['monitor', 'client', 'customer', 'feedback', 'status', 'evening', 'summary', 'news', 'aggregator'],
    system: ['system', 'admin', 'logger', 'qa', 'check', 'guard', 'hardening', 'skill-creator', 'improving', 'qmd', 'tax', 'server', 'agent'],
};

function inferCategory(name: string, desc: string): string {
    const text = `${name} ${desc}`.toLowerCase();
    let best = 'system';
    let bestScore = 0;
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        const score = keywords.filter(kw => text.includes(kw)).length;
        if (score > bestScore) { bestScore = score; best = cat; }
    }
    return best;
}

// ── Default emoji by category ───────────────────────────────────────
const DEFAULT_EMOJI: Record<string, string> = {
    search: '🔍', automation: '⚙️', content: '📝', monitor: '📊', system: '🔧',
};

// ── YAML frontmatter parser (simple) ────────────────────────────────
function parseFrontmatter(raw: string): Record<string, unknown> {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const data: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx < 1) continue;
        const key = line.slice(0, idx).trim();
        let val: string | unknown = line.slice(idx + 1).trim();
        // Strip surrounding quotes
        if (typeof val === 'string' && /^".*"$/.test(val)) val = val.slice(1, -1);
        // Try JSON parse for metadata
        if (key === 'metadata' && typeof val === 'string') {
            try { val = JSON.parse(val); } catch { /* keep string */ }
        }
        data[key] = val;
    }
    return data;
}

// ── Main ────────────────────────────────────────────────────────────
interface SkillEntry {
    name: string;
    emoji: string;
    description: string;
    category: string;
    source: string;
}

const skillMap = new Map<string, SkillEntry>();

for (const dir of SKILL_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const source = dir.includes('clawd') ? 'clawd' : 'openclaw';

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;

        // Clawd takes priority — skip if already seen
        if (skillMap.has(entry.name) && source !== 'clawd') continue;

        const raw = fs.readFileSync(skillMd, 'utf-8');
        const fm = parseFrontmatter(raw);

        const name = (fm.name as string) || entry.name;
        const description = (fm.description as string) || '';
        const meta = fm.metadata as Record<string, Record<string, string>> | undefined;
        const emoji = meta?.clawdbot?.emoji || '';
        const category = inferCategory(name, description);

        skillMap.set(entry.name, {
            name,
            emoji: emoji || DEFAULT_EMOJI[category] || '🔧',
            description: description || `${name} skill`,
            category,
            source,
        });
    }
}

const skills = [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name));

// Write output
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(skills, null, 2));
console.log(`✅ Generated ${skills.length} skills → ${OUT}`);
