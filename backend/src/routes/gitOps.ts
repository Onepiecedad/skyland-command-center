import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { execSync } from 'child_process';

const router = Router();

// ============================================================================
// Configuration
// ============================================================================
const GIT_REPO_PATH = process.env.GIT_REPO_PATH;

if (!GIT_REPO_PATH) {
    throw new Error('GIT_REPO_PATH environment variable is required');
}

const PROTECTED_BRANCHES = ['main', 'master'];

// ============================================================================
// Helpers
// ============================================================================

function runGit(args: string): string {
    try {
        return execSync(`git ${args}`, {
            cwd: GIT_REPO_PATH,
            encoding: 'utf-8',
            timeout: 15000,
        }).trim();
    } catch (err: unknown) {
        const error = err as { stderr?: string; message: string };
        throw new Error(error.stderr || error.message);
    }
}

function getCurrentBranch(): string {
    return runGit('rev-parse --abbrev-ref HEAD');
}

// ============================================================================
// GET /api/v1/git/status — Git status
// ============================================================================
router.get('/status', (_req: Request, res: Response) => {
    try {
        const porcelain = runGit('status --porcelain');
        const branch = getCurrentBranch();
        const lastCommit = runGit('log -1 --format="%H|%s|%ai"');
        const [hash, subject, date] = lastCommit.split('|');

        const files = porcelain
            ? porcelain.split('\n').map(line => ({
                status: line.substring(0, 2).trim(),
                file: line.substring(3),
            }))
            : [];

        return res.json({
            branch,
            clean: files.length === 0,
            files,
            file_count: files.length,
            last_commit: { hash, subject, date },
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Git status error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/v1/git/diff — Git diff
// ============================================================================
router.get('/diff', (req: Request, res: Response) => {
    try {
        const staged = req.query.staged === 'true';
        const diffCmd = staged ? 'diff --cached' : 'diff';
        const diff = runGit(diffCmd);

        // Parse diff into file-level chunks
        const fileChunks: { file: string; changes: string }[] = [];
        const diffParts = diff.split(/^diff --git /m).filter(Boolean);

        for (const part of diffParts) {
            const firstNewline = part.indexOf('\n');
            const header = part.substring(0, firstNewline);
            // Extract filename from "a/path b/path"
            const fileMatch = header.match(/b\/(.+)$/);
            const file = fileMatch ? fileMatch[1] : header;

            fileChunks.push({
                file,
                changes: 'diff --git ' + part,
            });
        }

        return res.json({
            diff: diff || '(no changes)',
            files: fileChunks,
            file_count: fileChunks.length,
            staged,
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Git diff error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// POST /api/v1/git/add — Stage files
// ============================================================================
const addSchema = z.object({
    files: z.array(z.string()).min(1).default(['.'])
});

router.post('/add', (req: Request, res: Response) => {
    try {
        const parsed = addSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }

        const fileArgs = parsed.data.files.map(f => `"${f}"`).join(' ');
        runGit(`add ${fileArgs}`);

        // Return updated status
        const status = runGit('status --porcelain');

        return res.json({
            success: true,
            staged_files: parsed.data.files,
            status: status || '(clean)',
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Git add error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// POST /api/v1/git/commit — Commit staged changes
// Mandatory: returns diff + status before committing
// ============================================================================
const commitSchema = z.object({
    message: z.string().min(1).max(500),
});

router.post('/commit', (req: Request, res: Response) => {
    try {
        const parsed = commitSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }

        // Mandatory pre-commit output (Ticket 5.1 requirement)
        const preStatus = runGit('status --porcelain');
        const preDiff = runGit('diff --cached --stat');

        if (!preStatus) {
            return res.status(400).json({
                error: 'Nothing to commit — working tree clean',
                pre_commit: { status: '(clean)', diff_stat: '' },
            });
        }

        // Escape message for shell
        const safeMessage = parsed.data.message.replace(/"/g, '\\"');
        const result = runGit(`commit -m "${safeMessage}"`);

        const postHash = runGit('rev-parse --short HEAD');

        return res.json({
            success: true,
            commit_hash: postHash,
            message: parsed.data.message,
            result,
            pre_commit: {
                status: preStatus,
                diff_stat: preDiff,
            },
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Git commit error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// POST /api/v1/git/push — Push to remote
// Protected branch check: main/master require approval queue
// ============================================================================
router.post('/push', (_req: Request, res: Response) => {
    try {
        const branch = getCurrentBranch();

        // Critical branch protection (Ticket 5.1 requirement)
        if (PROTECTED_BRANCHES.includes(branch)) {
            return res.status(403).json({
                error: 'APPROVAL_REQUIRED',
                message: `Push till '${branch}' kräver godkännande. Skapa en approval request.`,
                branch,
                action: 'Använd Approval Queue för att godkänna push till skyddad branch.',
            });
        }

        const result = runGit(`push origin ${branch}`);

        return res.json({
            success: true,
            branch,
            result: result || 'Push completed',
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Git push error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/v1/git/log — Recent commits
// ============================================================================
router.get('/log', (req: Request, res: Response) => {
    try {
        const count = Math.min(parseInt(req.query.count as string) || 10, 50);
        const log = runGit(`log -${count} --format="%H|%h|%s|%an|%ai"`);

        const commits = log ? log.split('\n').map(line => {
            const [hash, shortHash, subject, author, date] = line.split('|');
            return { hash, shortHash, subject, author, date };
        }) : [];

        return res.json({
            branch: getCurrentBranch(),
            commits,
            count: commits.length,
        });
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Git log error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

export default router;
