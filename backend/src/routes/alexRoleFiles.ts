import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// Workspace where Alex's identity/brain files live (e.g. ~/clawd).
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || process.env.HOME || '';

interface RoleFileDef {
  key: string;
  label: string;
  description: string;
  icon: string;
  filename: string;
}

// The files that define who Alex is and how it works.
const ROLE_FILES: RoleFileDef[] = [
  { key: 'identity', label: 'Identitet', description: 'Vem Alex är', icon: 'user', filename: 'IDENTITY.md' },
  { key: 'soul', label: 'Soul', description: 'Kärnvärden och ton', icon: 'heart', filename: 'SOUL.md' },
  { key: 'agents', label: 'Agents', description: 'Bas-instruktioner och boot', icon: 'bot', filename: 'AGENTS.md' },
  { key: 'tools', label: 'Verktyg', description: 'Modeller och verktygsalias', icon: 'wrench', filename: 'TOOLS.md' },
  { key: 'memory', label: 'Minne', description: 'Långtidsminne', icon: 'brain', filename: 'MEMORY.md' },
  { key: 'heartbeat', label: 'Heartbeat', description: 'Daglig drift och rutiner', icon: 'activity', filename: 'HEARTBEAT.md' },
];

// GET /api/v1/alex/role-files — returns the role/brain files with content + metadata.
router.get('/role-files', (_req: Request, res: Response) => {
  const files = ROLE_FILES.map((def) => {
    const fullPath = path.join(WORKSPACE_DIR, def.filename);
    try {
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { ...def, content, size: stat.size, modified: stat.mtime.toISOString() };
    } catch {
      return { ...def, content: null, error: 'Filen hittades inte' };
    }
  });
  res.json({ files, workspace: WORKSPACE_DIR });
});

export default router;
