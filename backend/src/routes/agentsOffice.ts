import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../services/supabase';
import { summarizeBatch, outcomesByAgent, type CostRow } from '../services/officeBatch';

const router = Router();

// SCC-49 etapp 1–2: batchkortet + utfall per nod, ur costs (plan 2.4). Best effort:
// faller DB-frågan slutar kontoret aldrig fungera, kortet uteblir bara.
async function loadBatchAndOutcomes(): Promise<{ batch: ReturnType<typeof summarizeBatch>; outcomes: ReturnType<typeof outcomesByAgent> }> {
    try {
        // Svensk dygnsgräns; containern kör UTC.
        const now = new Date();
        const seStart = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
        seStart.setHours(0, 0, 0, 0);
        const offsetMs = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' })).getTime();
        const sinceIso = new Date(seStart.getTime() + offsetMs).toISOString();

        const { data, error } = await supabase
            .from('costs')
            .select('created_at, agent, model, cost_usd, meta')
            .like('agent', 'pipeline:%')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(500);
        if (error) throw error;
        const rows = (data ?? []) as CostRow[];

        // Utfallsprickar ska visa minne även en lugn dag: fyll på med de senaste 40 oavsett datum.
        let pool = rows;
        if (rows.length < 40) {
            const { data: older } = await supabase
                .from('costs')
                .select('created_at, agent, model, cost_usd, meta')
                .like('agent', 'pipeline:%')
                .order('created_at', { ascending: false })
                .limit(40);
            pool = (older ?? []) as CostRow[];
        }
        return { batch: summarizeBatch(rows), outcomes: outcomesByAgent(pool) };
    } catch (err) {
        console.warn('[Office] batch/outcomes unavailable:', err instanceof Error ? err.message : err);
        return { batch: null, outcomes: {} };
    }
}

// OpenClaw stores each agent's sessions under ~/.openclaw/agents/<id>/sessions/.
// We read trajectory files directly so sub-agent activity is visible even
// though the gateway sessions API only exposes the main agent.
const AGENTS_DIR = path.join(process.env.HOME || '', '.openclaw', 'agents');

const AGENT_IDS = [
  'main', 'orchestrator', 'researcher', 'research-librarian',
  'analyst', 'strategy-analyst', 'writer', 'dm-writer', 'lyra',
];

const ACTIVE_MS = 60_000;        // trajectory written this recently => running
const WAITING_MS = 5 * 60_000;   // recently active, likely awaiting/handing back

interface AgentActivity {
  id: string;
  status: 'active' | 'waiting' | 'idle' | 'error';
  task: string;
  ageMs: number | null;
}

// Pull the latest user/prompt text from a session's trajectory tail.
function extractTask(trajectoryPath: string): string {
  try {
    const lines = fs.readFileSync(trajectoryPath, 'utf-8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && i > lines.length - 80; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e.type === 'prompt.submitted' || e.type === 'context.compiled') {
          const p = e.data?.prompt;
          if (typeof p === 'string' && p.trim()) {
            return p.replace(/^RÖSTSAMTAL[^:]*:\s*/i, '').replace(/\s+/g, ' ').slice(0, 90);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* no file */ }
  return '';
}

function newestTrajectory(dir: string): { file: string; mtime: number } | null {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.trajectory.jsonl'));
    let best: { file: string; mtime: number } | null = null;
    for (const f of files) {
      const full = path.join(dir, f);
      const m = fs.statSync(full).mtimeMs;
      if (!best || m > best.mtime) best = { file: full, mtime: m };
    }
    return best;
  } catch {
    return null;
  }
}

// GET /api/v1/agents/office — live activity for main + sub-agents.
router.get('/office', async (_req: Request, res: Response) => {
  const now = Date.now();
  const { batch, outcomes } = await loadBatchAndOutcomes();
  const agents: AgentActivity[] = AGENT_IDS.map((id) => {
    const sessionsDir = path.join(AGENTS_DIR, id, 'sessions');
    const newest = newestTrajectory(sessionsDir);
    if (!newest) return { id, status: 'idle', task: '', ageMs: null };

    const ageMs = now - newest.mtime;
    let status: AgentActivity['status'] = 'idle';
    if (ageMs < ACTIVE_MS) status = 'active';
    else if (ageMs < WAITING_MS) status = 'waiting';

    const task = status === 'active' ? extractTask(newest.file) : '';
    return { id, status, task, ageMs };
  });

  res.json({ agents, batch, outcomes, ts: now });
});

export default router;
