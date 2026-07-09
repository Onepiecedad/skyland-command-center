import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

// The gateway stores its scheduled jobs + run logs in the live SQLite DB.
// We read it READ-ONLY via the sqlite3 CLI (no extra npm dependency, same
// execSync pattern as the git panel) so the dashboard shows the REAL cron
// jobs and their real run history — not hardcoded mock data.
const DB = path.join(process.env.HOME || '', '.openclaw', 'state', 'openclaw.sqlite');

interface AutomationRow {
  job_id: string;
  name: string;
  enabled: number;
  schedule_expr: string | null;
  schedule_tz: string | null;
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  last_run_status: string | null;
  run_count: number;
  last_error: string | null;
  last_summary: string | null;
}

interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  tz: string | null;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'IDLE';
  lastRun: string | null;
  lastRunStatus: string | null;
  nextRun: string | null;
  executionCount: number;
  lastError: string | null;
  lastSummary: string | null;
}

const QUERY = `SELECT j.job_id, j.name, j.enabled, j.schedule_expr, j.schedule_tz,
  j.next_run_at_ms, j.last_run_at_ms, j.last_run_status,
  (SELECT COUNT(*) FROM cron_run_logs r WHERE r.job_id = j.job_id) AS run_count,
  (SELECT r.error FROM cron_run_logs r WHERE r.job_id = j.job_id ORDER BY r.seq DESC LIMIT 1) AS last_error,
  (SELECT r.summary FROM cron_run_logs r WHERE r.job_id = j.job_id ORDER BY r.seq DESC LIMIT 1) AS last_summary
  FROM cron_jobs j ORDER BY j.enabled DESC, j.name;`;

// macOS ships sqlite3 at /usr/bin/sqlite3; fall back to PATH lookup.
const SQLITE_BIN = fs.existsSync('/usr/bin/sqlite3') ? '/usr/bin/sqlite3' : 'sqlite3';

function readRows(): AutomationRow[] {
  if (!fs.existsSync(DB)) return [];
  // -readonly is safe against the live (WAL) DB; .mode json gives a JSON array.
  const out = execFileSync(SQLITE_BIN, ['-readonly', DB, '.mode json', QUERY], {
    encoding: 'utf-8', timeout: 5000,
  }).trim();
  if (!out) return [];
  return JSON.parse(out);
}

function toStatus(enabled: number, lastStatus: string | null): Automation['status'] {
  if (!enabled) return 'IDLE';
  const s = (lastStatus || '').toLowerCase();
  if (s === 'error' || s === 'failed') return 'CRITICAL';
  if (s === 'skipped' || s === 'timeout') return 'DEGRADED';
  return 'HEALTHY';
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

// GET /api/v1/automations — the real scheduled jobs + run history.
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = readRows();
    const jobs: Automation[] = rows.map((r) => ({
      id: r.job_id,
      name: r.name,
      enabled: !!r.enabled,
      schedule: r.schedule_expr,
      tz: r.schedule_tz,
      status: toStatus(r.enabled, r.last_run_status),
      lastRun: iso(r.last_run_at_ms),
      lastRunStatus: r.last_run_status,
      nextRun: iso(r.next_run_at_ms),
      executionCount: r.run_count || 0,
      lastError: r.last_error,
      lastSummary: r.last_summary,
    }));
    const summary = {
      healthy: jobs.filter((j) => j.status === 'HEALTHY').length,
      degraded: jobs.filter((j) => j.status === 'DEGRADED').length,
      critical: jobs.filter((j) => j.status === 'CRITICAL').length,
      idle: jobs.filter((j) => j.status === 'IDLE').length,
    };
    res.json({ jobs, summary, source: 'openclaw.sqlite' });
  } catch (err: unknown) {
    res.status(200).json({
      jobs: [], summary: { healthy: 0, degraded: 0, critical: 0, idle: 0 },
      error: err instanceof Error ? err.message : 'kunde inte läsa cron-databasen',
    });
  }
});

// ── Actions ────────────────────────────────────────────────────────────────

const GATEWAY = process.env.CLAWDBOT_GATEWAY_URL || 'http://127.0.0.1:18789';

function hooksToken(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME || '', '.openclaw', 'openclaw.json'), 'utf-8'));
    return cfg?.hooks?.token || '';
  } catch {
    return '';
  }
}

function jobPayload(id: string): { agentId: string; message: string } | null {
  if (!fs.existsSync(DB)) return null;
  const out = execFileSync(SQLITE_BIN, ['-readonly', DB, '.mode json',
    `SELECT agent_id, payload_message FROM cron_jobs WHERE job_id='${id.replace(/'/g, "''")}';`],
    { encoding: 'utf-8', timeout: 5000 }).trim();
  if (!out) return null;
  const rows = JSON.parse(out);
  if (!rows.length) return null;
  return { agentId: rows[0].agent_id || 'main', message: rows[0].payload_message || '' };
}

// POST /api/v1/automations/:id/run — trigger the job NOW by re-dispatching its
// payload to the gateway's /hooks/agent (the same proven path the pipeline uses).
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const job = jobPayload(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'jobb hittades inte' });
    const token = hooksToken();
    if (!token) return res.status(503).json({ ok: false, error: 'hooks-token saknas i openclaw.json' });
    const r = await fetch(`${GATEWAY}/hooks/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        message: job.message, name: 'scc-manual-run', wakeMode: 'now',
        sessionKey: `hook:scc-cron-${Date.now()}`, agentId: job.agentId,
        deliver: false, allowUnsafeExternalContent: true,
      }),
    });
    return res.json({ ok: r.ok, status: r.status, error: r.ok ? undefined : `gateway HTTP ${r.status}` });
  } catch (err: unknown) {
    return res.status(200).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/v1/automations/:id/toggle  { enabled: boolean }
// Enable/disable via the official `openclaw cron` CLI (it talks to the gateway
// correctly — no risky direct DB writes). Best-effort: reports CLI errors back.
router.post('/:id/toggle', (req: Request, res: Response) => {
  const enable = !!req.body?.enabled;
  try {
    const out = execFileSync('openclaw', ['cron', enable ? 'enable' : 'disable', req.params.id],
      { encoding: 'utf-8', timeout: 10000 });
    res.json({ ok: true, enabled: enable, out: out.trim().slice(0, 300) });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    res.status(200).json({ ok: false, error: (e.stderr || e.message || 'okänt CLI-fel').toString().slice(0, 300) });
  }
});

export default router;
