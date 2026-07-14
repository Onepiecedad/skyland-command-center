import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

/**
 * SCC-39 — Deliverables-arkivet bor nu i Supabase (tabell `deliverables`),
 * inte på operatörens disk. Samma svarskontrakt som den gamla filbaserade
 * routen så att ArchiveView fungerar oförändrad:
 *   GET  /                  → { entries, total, facets }
 *   GET  /:id               → { entry, report, artifacts: string[] }
 *   GET  /:id/raw/:file     → artefaktens innehåll (text/json)
 *   POST /                  → skapa deliverable (sub-agenter/n8n/research-flödet)
 *   DELETE /:id             → ta bort
 *
 * Artefakter lagras inline som [{ name, content }] i jsonb (endast text).
 */

interface DeliverableRow {
    id: string;
    type: string;
    entity: Record<string, unknown>;
    status: string | null;
    score: number | null;
    gate_pass: boolean | null;
    title: string | null;
    summary: string | null;
    tags: string[];
    report_md: string | null;
    artifacts: Array<{ name: string; content?: string }>;
    date: string | null;
    created_at: string;
}

/** Mappa DB-rad → entry-formen som frontenden förväntar sig. */
function toEntry(row: DeliverableRow) {
    return {
        id: row.id,
        type: row.type,
        entity: row.entity,
        date: row.date ?? row.created_at,
        status: row.status ?? undefined,
        score: row.score,
        gate_pass: row.gate_pass,
        title: row.title ?? undefined,
        summary: row.summary ?? undefined,
        tags: row.tags ?? [],
    };
}

// GET / — lista/sök. Query: q, status, type, tag, person, limit
router.get('/', async (req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('deliverables')
        .select('id, type, entity, status, score, gate_pass, title, summary, tags, date, created_at')
        .order('date', { ascending: false, nullsFirst: false });
    if (error) return res.status(500).json({ error: error.message });

    const all = (data ?? []) as DeliverableRow[];
    let entries = all.map(toEntry);

    const q = String(req.query.q || '').toLowerCase();
    const status = String(req.query.status || '').toLowerCase();
    const type = String(req.query.type || '').toLowerCase();
    const tag = String(req.query.tag || '').toLowerCase();
    const person = String(req.query.person || '').toLowerCase();
    const limit = Number(req.query.limit) || 0;

    const hay = (e: ReturnType<typeof toEntry>) => {
        const ent = e.entity as { name?: string; slug?: string; org_nr?: string } | undefined;
        return [e.title, e.summary, ent?.name, ent?.slug, ent?.org_nr]
            .filter(Boolean).join(' ').toLowerCase();
    };

    if (q) entries = entries.filter((e) => hay(e).includes(q));
    if (status) entries = entries.filter((e) => (e.status || '').toLowerCase() === status);
    if (type) entries = entries.filter((e) => (e.type || '').toLowerCase() === type);
    if (tag) entries = entries.filter((e) => (e.tags || []).some((t) => t.toLowerCase() === tag));
    if (person) entries = entries.filter((e) => hay(e).includes(person));
    if (limit > 0) entries = entries.slice(0, limit);

    const facets = {
        statuses: [...new Set(all.map((e) => e.status).filter(Boolean))],
        types: [...new Set(all.map((e) => e.type).filter(Boolean))],
        tags: [...new Set(all.flatMap((e) => e.tags || []))],
    };

    return res.json({ entries, total: entries.length, facets });
});

// GET /:id — en post med rapport + artefaktnamn
router.get('/:id', async (req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('deliverables')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });

    const row = data as DeliverableRow;
    const artifacts = (row.artifacts ?? []).map((a) => a.name);
    return res.json({ entry: toEntry(row), report: row.report_md, artifacts });
});

// GET /:id/raw/:file — artefaktinnehåll
router.get('/:id/raw/:file', async (req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('deliverables')
        .select('artifacts')
        .eq('id', req.params.id)
        .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    const artifacts = ((data?.artifacts ?? []) as Array<{ name: string; content?: string }>);
    const artifact = artifacts.find((a) => a.name === req.params.file);
    if (!artifact || artifact.content === undefined) return res.status(404).json({ error: 'not found' });
    res.type(req.params.file.endsWith('.json') ? 'application/json' : 'text/plain');
    return res.send(artifact.content);
});

// POST / — skapa deliverable (framtida research-flöde, n8n, sub-agent-callbacks)
router.post('/', async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (typeof b.title !== 'string' && typeof b.id !== 'string') {
        return res.status(400).json({ error: 'title eller id krävs' });
    }
    const id: string = typeof b.id === 'string' && b.id.trim()
        ? b.id.trim()
        : `${String(b.type || 'report')}_${Date.now()}`;

    const { data, error } = await supabase
        .from('deliverables')
        .upsert({
            id,
            type: typeof b.type === 'string' ? b.type : 'report',
            entity: typeof b.entity === 'object' && b.entity !== null ? b.entity : {},
            status: typeof b.status === 'string' ? b.status : null,
            score: typeof b.score === 'number' ? b.score : null,
            gate_pass: typeof b.gate_pass === 'boolean' ? b.gate_pass : null,
            title: typeof b.title === 'string' ? b.title : null,
            summary: typeof b.summary === 'string' ? b.summary : null,
            tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
            report_md: typeof b.report_md === 'string' ? b.report_md : null,
            artifacts: Array.isArray(b.artifacts) ? b.artifacts : [],
            source: typeof b.source === 'string' ? b.source : 'api',
            contact_id: typeof b.contact_id === 'string' ? b.contact_id : null,
            customer_id: typeof b.customer_id === 'string' ? b.customer_id : null,
            date: typeof b.date === 'string' ? b.date : new Date().toISOString(),
        })
        .select('id')
        .single();
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('activities').insert({
        customer_id: typeof b.customer_id === 'string' ? b.customer_id : null,
        agent: 'system:archive',
        event_type: 'deliverable',
        action: 'deliverable_created',
        severity: 'info',
        details: { deliverable_id: data.id, type: b.type ?? 'report', title: b.title ?? null },
    });

    return res.status(201).json({ ok: true, id: data.id });
});

// DELETE /:id
router.delete('/:id', async (req: Request, res: Response) => {
    const { error, count } = await supabase
        .from('deliverables')
        .delete({ count: 'exact' })
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    if (!count) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: true, deleted: req.params.id });
});

export default router;
