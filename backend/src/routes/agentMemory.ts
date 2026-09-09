import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

/**
 * Agentens långtidsminne — spegel av OpenClaws arbetskatalog.
 *
 * Minnet skrivs som markdown i ~/clawd på maskinen där agenten kör: MEMORY.md
 * (kurerat) och memory/YYYY-MM-DD.md (compaction.memoryFlush). Backendn kör på
 * Render och kan inte läsa den katalogen, så scripts/sync_memory.py på VPS:en
 * speglar filerna till tabellen agent_memory. Den här rutten läser bara spegeln.
 *
 * Ersätter routes/alexMemory.ts, som läste filerna direkt och därför alltid
 * svarade tomt i molnet.
 */
const router = Router();

const MAX = 200;

/** GET /list — senaste minnena, långtidsminnet först. */
router.get('/list', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, MAX);
    const { data, error } = await supabase
        .from('agent_memory')
        .select('id, kind, path, title, content, bytes, file_mtime, synced_at, host')
        .is('deleted_at', null)
        .order('kind', { ascending: true })     // 'daily' < 'longterm' alfabetiskt
        .order('file_mtime', { ascending: false })
        .limit(limit);

    if (error) return res.status(500).json({ error: error.message });

    // Långtidsminnet är den viktigaste raden och ska ligga överst, inte sorteras
    // in bland dagarna efter mtime.
    const rader = data ?? [];
    const langtid = rader.filter(r => r.kind === 'longterm');
    const dagliga = rader.filter(r => r.kind !== 'longterm');

    return res.json({
        entries: [...langtid, ...dagliga].map(r => formatera(r)),
        count: rader.length,
        synced_at: rader.reduce<string | null>(
            (senast, r) => (!senast || r.synced_at > senast ? r.synced_at : senast), null),
    });
});

/** POST /search — fritextsökning i speglat minne. */
router.post('/search', async (req: Request, res: Response) => {
    const query = String((req.body?.query ?? '')).trim();
    const limit = Math.min(parseInt(String(req.body?.limit || '20'), 10) || 20, MAX);

    let q = supabase
        .from('agent_memory')
        .select('id, kind, path, title, content, bytes, file_mtime, synced_at, host')
        .is('deleted_at', null);

    if (query) {
        // Enkel innehållsmatchning. Kommatecken bryter PostgREST:s or-syntax,
        // så de tas bort ur söksträngen i stället för att spränga frågan.
        const s = query.replace(/[,()]/g, ' ').trim();
        q = q.or(`content.ilike.%${s}%,title.ilike.%${s}%`);
    }

    const { data, error } = await q
        .order('file_mtime', { ascending: false })
        .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: (data ?? []).map(r => formatera(r, query)), count: data?.length ?? 0, query });
});

/** Klipp ut ett stycke runt träffen, annars början av filen. */
function formatera(r: Record<string, unknown>, query?: string) {
    const innehall = String(r.content ?? '');
    let utdrag = innehall;

    if (query) {
        const i = innehall.toLowerCase().indexOf(query.toLowerCase());
        if (i > 200) utdrag = '…' + innehall.slice(i - 120);
    }
    if (utdrag.length > 700) utdrag = utdrag.slice(0, 700).trimEnd() + '…';

    return {
        id: String(r.id ?? ''),
        content: utdrag,
        source: r.kind === 'longterm' ? 'Långtidsminne' : String(r.title ?? r.path ?? ''),
        timestamp: (r.file_mtime ?? r.synced_at) as string,
        kind: r.kind as string,
        path: r.path as string,
        bytes: r.bytes as number,
    };
}

export default router;
