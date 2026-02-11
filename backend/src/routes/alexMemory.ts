import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// ============================================================================
// Configuration
// ============================================================================
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || process.env.HOME || '/Users/onepiecedad';
const MEMORY_FILE = path.join(WORKSPACE_DIR, 'MEMORY.md');
const MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory');

// ============================================================================
// Types
// ============================================================================
interface MemoryEntry {
    id: string;
    content: string;
    source: string;
    timestamp?: string;
    score?: number;
}

// ============================================================================
// Helpers
// ============================================================================
function stripFrontMatter(content: string): string {
    if (!content.startsWith('---')) return content;
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) return content;
    return content.slice(endIndex + 4).trim();
}

function generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateContent(content: string, max = 500): string {
    if (content.length <= max) return content;
    return content.slice(0, max).trimEnd() + '…';
}

function getFileTimestamp(filePath: string): string | undefined {
    try {
        const stat = fs.statSync(filePath);
        return stat.mtime.toISOString();
    } catch {
        return undefined;
    }
}

function calculateRelevance(content: string, query: string): number {
    const lowerContent = content.toLowerCase();
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1);
    
    let score = 0;
    for (const kw of keywords) {
        const regex = new RegExp(kw, 'g');
        const matches = lowerContent.match(regex);
        if (matches) {
            score += matches.length * 10;
        }
    }
    
    // Normalize to 0-1 range
    return Math.min(score / 100, 1);
}

// ============================================================================
// Read all memory files
// ============================================================================
async function readAllMemoryFiles(): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    
    // Read MEMORY.md
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
            const stripped = stripFrontMatter(content);
            if (stripped.trim()) {
                entries.push({
                    id: generateId(),
                    content: truncateContent(stripped),
                    source: 'MEMORY.md',
                    timestamp: getFileTimestamp(MEMORY_FILE),
                });
            }
        }
    } catch (err) {
        console.error('Failed to read MEMORY.md:', err);
    }
    
    // Read memory/*.md
    try {
        if (fs.existsSync(MEMORY_DIR)) {
            const files = fs.readdirSync(MEMORY_DIR)
                .filter(f => f.endsWith('.md'))
                .sort()
                .reverse(); // Newest first
            
            for (const file of files) {
                const filePath = path.join(MEMORY_DIR, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const stripped = stripFrontMatter(content);
                    if (stripped.trim()) {
                        entries.push({
                            id: generateId(),
                            content: truncateContent(stripped),
                            source: `memory/${file}`,
                            timestamp: getFileTimestamp(filePath),
                        });
                    }
                } catch (err) {
                    console.error(`Failed to read ${filePath}:`, err);
                }
            }
        }
    } catch (err) {
        console.error('Failed to read memory directory:', err);
    }
    
    return entries;
}

// ============================================================================
// GET /list — List all memory entries
// ============================================================================
const listSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
});

router.get('/list', async (req: Request, res: Response) => {
    try {
        const parsed = listSchema.safeParse(req.query);
        
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues,
            });
        }
        
        const { limit } = parsed.data;
        const entries = await readAllMemoryFiles();
        
        return res.json({
            entries: entries.slice(0, limit),
            count: entries.length,
        });
    } catch (err) {
        console.error('Memory list error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /search — Search memory entries
// ============================================================================
const searchSchema = z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(100).default(20),
});

router.post('/search', async (req: Request, res: Response) => {
    try {
        const parsed = searchSchema.safeParse(req.body);
        
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues,
            });
        }
        
        const { query, limit } = parsed.data;
        const entries = await readAllMemoryFiles();
        
        // Score and filter
        const scored = entries
            .map(entry => ({
                ...entry,
                score: calculateRelevance(entry.content, query),
            }))
            .filter(entry => entry.score > 0)
            .sort((a, b) => (b.score || 0) - (a.score || 0));
        
        return res.json({
            entries: scored.slice(0, limit),
            count: scored.length,
            query,
        });
    } catch (err) {
        console.error('Memory search error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /raw — Get raw MEMORY.md content (for debugging)
// ============================================================================
router.get('/raw', async (_req: Request, res: Response) => {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            return res.json({ content: '', exists: false });
        }
        
        const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return res.json({
            content,
            exists: true,
            path: MEMORY_FILE,
            timestamp: getFileTimestamp(MEMORY_FILE),
        });
    } catch (err) {
        console.error('Memory raw read error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
