import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// The deterministic deliverables archive built by the lead pipeline / Alex.
// Canonical store: ${OPENCLAW_WORKSPACE}/archive (default ~/clawd/archive).
// index.json holds one entry per deliverable (report, lead run, brief, …).
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || '', 'clawd');
const ARCHIVE_ROOT = path.join(WORKSPACE, 'archive');
const INDEX_PATH = path.join(ARCHIVE_ROOT, 'index.json');

interface DeliverableEntry {
  id: string;
  type: string;
  entity?: { kind?: string; name?: string; org_nr?: string | null; slug?: string };
  date?: string;
  status?: string;
  score?: number | null;
  gate_pass?: boolean | null;
  title?: string;
  summary?: string;
  tags?: string[];
  paths?: { dir?: string; report?: string | null; research?: string | null; analysis?: string | null };
}

function readIndex(): DeliverableEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    const entries: DeliverableEntry[] = Array.isArray(raw.entries) ? raw.entries : [];
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return entries;
  } catch {
    return [];
  }
}

// Guard against path traversal: only allow reading files inside ARCHIVE_ROOT.
function safeJoin(rel: string): string | null {
  const full = path.resolve(ARCHIVE_ROOT, rel);
  if (full !== ARCHIVE_ROOT && !full.startsWith(ARCHIVE_ROOT + path.sep)) return null;
  return full;
}

// GET /api/v1/deliverables — list/search. Query: q, status, type, tag, person, limit
router.get('/', (req: Request, res: Response) => {
  let entries = readIndex();
  const q = String(req.query.q || '').toLowerCase();
  const status = String(req.query.status || '').toLowerCase();
  const type = String(req.query.type || '').toLowerCase();
  const tag = String(req.query.tag || '').toLowerCase();
  const person = String(req.query.person || '').toLowerCase();
  const limit = Number(req.query.limit) || 0;

  const hay = (e: DeliverableEntry) =>
    [e.title, e.summary, e.entity?.name, e.entity?.slug, e.entity?.org_nr]
      .filter(Boolean).join(' ').toLowerCase();

  if (q) entries = entries.filter((e) => hay(e).includes(q));
  if (status) entries = entries.filter((e) => (e.status || '').toLowerCase() === status);
  if (type) entries = entries.filter((e) => (e.type || '').toLowerCase() === type);
  if (tag) entries = entries.filter((e) => (e.tags || []).some((t) => t.toLowerCase() === tag));
  if (person) entries = entries.filter((e) => hay(e).includes(person));
  if (limit > 0) entries = entries.slice(0, limit);

  // facets help the UI build filter chips
  const all = readIndex();
  const facets = {
    statuses: [...new Set(all.map((e) => e.status).filter(Boolean))],
    types: [...new Set(all.map((e) => e.type).filter(Boolean))],
    tags: [...new Set(all.flatMap((e) => e.tags || []))],
  };

  res.json({ entries, total: entries.length, facets });
});

// GET /api/v1/deliverables/:id — one entry, with the report.md body inlined.
router.get('/:id', (req: Request, res: Response) => {
  const entry = readIndex().find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });

  let report: string | null = null;
  if (entry.paths?.report) {
    const full = safeJoin(entry.paths.report);
    if (full && fs.existsSync(full)) report = fs.readFileSync(full, 'utf-8');
  }
  // list raw artifacts in the run dir
  let artifacts: string[] = [];
  if (entry.paths?.dir) {
    const full = safeJoin(entry.paths.dir);
    if (full && fs.existsSync(full)) {
      try { artifacts = fs.readdirSync(full).filter((f) => f !== 'report.md'); } catch { /* ignore */ }
    }
  }
  return res.json({ entry, report, artifacts });
});

// GET /api/v1/deliverables/:id/raw/:file — fetch a raw artifact (json/md) from the run dir.
router.get('/:id/raw/:file', (req: Request, res: Response) => {
  const entry = readIndex().find((e) => e.id === req.params.id);
  if (!entry?.paths?.dir) return res.status(404).json({ error: 'not found' });
  const full = safeJoin(path.join(entry.paths.dir, req.params.file));
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
  res.type(req.params.file.endsWith('.json') ? 'application/json' : 'text/plain');
  return res.send(fs.readFileSync(full, 'utf-8'));
});

// DELETE /api/v1/deliverables/:id — remove an entry from the index and delete
// its run directory from disk. Guarded to the archive root (no traversal).
router.delete('/:id', (req: Request, res: Response) => {
  let raw: { entries?: DeliverableEntry[] };
  try {
    raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return res.status(500).json({ error: 'kunde inte läsa index' });
  }
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const entry = entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });

  // delete the run dir (guarded)
  if (entry.paths?.dir) {
    const full = safeJoin(entry.paths.dir);
    if (full && full !== ARCHIVE_ROOT && fs.existsSync(full)) {
      try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  const next = entries.filter((e) => e.id !== req.params.id);
  const tmp = INDEX_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...raw, entries: next, updated_at: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, INDEX_PATH);
  return res.json({ ok: true, deleted: req.params.id, remaining: next.length });
});

export default router;
