import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

/**
 * Gatewayns schemalagda jobb ligger i dess SQLite-databas — PÅ VPS:EN.
 *
 * Den här routen skrevs när backenden körde på Joakims Mac, bredvid den filen.
 * Sedan flytten till Render finns ingen `~/.openclaw` på maskinen som kör
 * koden, så `fs.existsSync(DB)` var alltid falskt och panelen visade
 * "Inga schemalagda jobb hittades" — trots att jobben körde varje natt.
 *
 * Riktningen är därför densamma som för claw-pollern och annonssynken:
 * VPS:en läser sin egen databas och POSTar hit (`POST /sync`), och GET läser
 * ur Supabase. Den lokala sqlite-läsningen är kvar som fallback, för när
 * någon kör backenden på samma maskin som gatewayn under utveckling.
 */
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
router.get('/', async (_req: Request, res: Response) => {
  try {
    let rows = readRows();
    let source = 'openclaw.sqlite';
    if (rows.length === 0) {
      // Normalfallet i produktion: filen finns inte här, VPS:en har speglat hit.
      const { data } = await supabase
        .from('gateway_cron_jobs')
        .select('*')
        .order('enabled', { ascending: false })
        .order('name');
      rows = (data ?? []).map((r) => ({
        job_id: r.job_id,
        name: r.name,
        enabled: r.enabled ? 1 : 0,
        schedule_expr: r.schedule_expr,
        schedule_tz: r.schedule_tz,
        next_run_at_ms: r.next_run_at ? Date.parse(r.next_run_at) : null,
        last_run_at_ms: r.last_run_at ? Date.parse(r.last_run_at) : null,
        last_run_status: r.last_run_status,
        run_count: r.run_count ?? 0,
        last_error: r.last_error,
        last_summary: r.last_summary,
      })) as AutomationRow[];
      source = 'vps-synk';
    }
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
    res.json({ jobs, summary, source });
  } catch (err: unknown) {
    res.status(200).json({
      jobs: [], summary: { healthy: 0, degraded: 0, critical: 0, idle: 0 },
      error: err instanceof Error ? err.message : 'kunde inte läsa cron-databasen',
    });
  }
});


// ── Synk från VPS:en ───────────────────────────────────────────────────────

const syncSchema = z.object({
  jobs: z.array(z.object({
    job_id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule_expr: z.string().nullish(),
    schedule_tz: z.string().nullish(),
    next_run_at: z.string().nullish(),
    last_run_at: z.string().nullish(),
    last_run_status: z.string().nullish(),
    run_count: z.number().int().nonnegative().default(0),
    last_error: z.string().nullish(),
    last_summary: z.string().nullish(),
    agent_id: z.string().nullish(),
  })).max(200),
});

// POST /api/v1/automations/sync — VPS:en speglar sin cron-databas hit.
router.post('/sync', async (req: Request, res: Response) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ogiltig payload', detaljer: parsed.error.flatten() });
  }
  const { jobs } = parsed.data;
  const nu = new Date().toISOString();

  if (jobs.length > 0) {
    const { error } = await supabase.from('gateway_cron_jobs').upsert(
      jobs.map((j) => ({
        ...j,
        last_summary: j.last_summary ? j.last_summary.slice(0, 2000) : null,
        last_error: j.last_error ? j.last_error.slice(0, 2000) : null,
        synced_at: nu,
      })),
      { onConflict: 'job_id' },
    );
    if (error) return res.status(500).json({ error: error.message });
  }

  // Jobb som tagits bort i gatewayn ska inte spöka kvar i panelen.
  const { error: delErr } = await supabase
    .from('gateway_cron_jobs')
    .delete()
    .not('job_id', 'in', `(${jobs.map((j) => `"${j.job_id}"`).join(',') || '""'})`);
  if (delErr) console.error('[automations] kunde inte städa borttagna jobb:', delErr.message);

  return res.json({ ok: true, synced: jobs.length });
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
    if (!fs.existsSync(DB)) {
      // Backenden kör på Render; gatewayn finns bara på VPS:en. Att svara 404
      // hade sett ut som "jobbet finns inte", vilket är fel diagnos.
      return res.status(501).json({
        ok: false,
        error: 'Kan inte köra jobbet härifrån — gatewayn nås bara från VPS:en. Kör `openclaw cron run <id>` där, eller be Alex göra det.',
      });
    }
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
  if (!fs.existsSync(DB)) {
    return res.status(501).json({
      ok: false,
      error: 'Kan inte slå av/på härifrån — openclaw-CLI:t finns bara på VPS:en. Kör `openclaw cron ' + (enable ? 'enable' : 'disable') + ' <id>` där.',
    });
  }
  try {
    const out = execFileSync('openclaw', ['cron', enable ? 'enable' : 'disable', req.params.id],
      { encoding: 'utf-8', timeout: 10000 });
    return res.json({ ok: true, enabled: enable, out: out.trim().slice(0, 300) });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    return res.status(200).json({ ok: false, error: (e.stderr || e.message || 'okänt CLI-fel').toString().slice(0, 300) });
  }
});

export default router;
