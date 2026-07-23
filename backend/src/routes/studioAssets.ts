import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';

/**
 * Studio-material-arkivet (Fas 1–2).
 *
 * Producerat material per studio (landningssidor, annonser, video, ark,
 * one-pagers, interna underlag) lagras binärt i Supabase Storage-bucketen
 * `studio-material` och indexeras i tabellen `studio_assets`, kopplad till
 * kontakten. Stora filer (video) laddas upp DIREKT till Storage via en
 * signerad upload-URL, så de aldrig passerar Renders 10 MB-JSON-gräns.
 *
 * Mountas under /api/v1/studio-assets bakom authMiddleware (se server.ts).
 */

const router = Router();
const BUCKET = 'studio-material';
const SIGN_TTL = 3600; // 1h

const KINDS = ['landing', 'ad', 'carousel', 'video', 'poster', 'sheet', 'one-pager', 'internal-brief', 'other'] as const;
const AUDIENCES = ['internal', 'client'] as const;

interface AssetRow {
    id: string;
    contact_id: string;
    kind: string;
    audience: string;
    title: string;
    storage_path: string;
    mime: string | null;
    file_size: number | null;
    version: number;
    is_latest: boolean;
    source: string | null;
    tags: string[];
    notes: string | null;
    created_at: string;
}

function slugify(s: string): string {
    return (s || 'studio')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'studio';
}

// ============================================================================
// GET / — lista material för en kontakt (med färska signerade view-URL:er)
// ============================================================================
router.get('/', async (req: Request, res: Response) => {
    try {
        const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : null;
        if (!contactId) return res.status(400).json({ error: 'contact_id krävs' });

        const { data, error } = await supabase
            .from('studio_assets')
            .select('*')
            .eq('contact_id', contactId)
            .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });

        const rows = (data ?? []) as AssetRow[];
        const signed = await Promise.all(rows.map(async (r) => {
            const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, SIGN_TTL);
            return { ...r, url: s?.signedUrl ?? null };
        }));

        return res.json({ assets: signed, count: signed.length });
    } catch (err) {
        logger.error('studioAssets', `list-fel: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// GET /:id/url — färsk signerad URL (nedladdning / kunddelning)
// ============================================================================
router.get('/:id/url', async (req: Request, res: Response) => {
    try {
        const { data: row, error } = await supabase
            .from('studio_assets').select('storage_path, title').eq('id', req.params.id).single();
        if (error || !row) return res.status(404).json({ error: 'Asset not found' });

        const ttl = Math.min(parseInt(String(req.query.ttl || SIGN_TTL), 10) || SIGN_TTL, 604800); // max 7 dygn
        const { data: s, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, ttl);
        if (sErr || !s) return res.status(500).json({ error: sErr?.message ?? 'sign failed' });
        return res.json({ url: s.signedUrl, expires_in: ttl });
    } catch (err) {
        logger.error('studioAssets', `url-fel: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// POST /upload-url — signerad upload-URL så klienten laddar upp direkt till
// Storage (kringgår Renders 10 MB-gräns för stora filer som video).
// ============================================================================
const uploadUrlSchema = z.object({
    contact_id: z.string().uuid(),
    filename: z.string().min(1).max(200),
    kind: z.enum(KINDS),
}).strict();

router.post('/upload-url', async (req: Request, res: Response) => {
    try {
        const parsed = uploadUrlSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        const { contact_id, filename, kind } = parsed.data;

        const { data: contact } = await supabase.from('contacts').select('name').eq('id', contact_id).single();
        const slug = slugify(contact?.name ?? '');
        const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const path = `${slug}/${kind}/${Date.now()}_${safe}`;

        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) return res.status(500).json({ error: error?.message ?? 'kunde inte skapa upload-URL' });

        // supabase-js returnerar antingen en full URL (nyare) eller en relativ path
        // (äldre). Bygg aldrig på bas-URL:en två gånger.
        const uploadUrl = data.signedUrl.startsWith('http')
            ? data.signedUrl
            : `${config.SUPABASE_URL}/storage/v1${data.signedUrl}`;

        return res.json({ path, upload_url: uploadUrl, token: data.token });
    } catch (err) {
        logger.error('studioAssets', `upload-url-fel: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// POST / — registrera en rad efter att filen laddats upp till Storage
// ============================================================================
const createSchema = z.object({
    contact_id: z.string().uuid(),
    opportunity_id: z.string().uuid().nullish(),
    kind: z.enum(KINDS),
    audience: z.enum(AUDIENCES).default('client'),
    title: z.string().min(1).max(200),
    storage_path: z.string().min(1),
    mime: z.string().nullish(),
    file_size: z.number().int().nonnegative().nullish(),
    source: z.string().nullish(),
    tags: z.array(z.string()).optional(),
    notes: z.string().nullish(),
}).strict();

router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

        const { data, error } = await supabase
            .from('studio_assets')
            .insert({ ...parsed.data, source: parsed.data.source ?? 'manuell-uppladdning' })
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });

        logger.info('studioAssets', `Material sparat: ${data.title} (${data.kind}) för ${data.contact_id}`);
        return res.status(201).json({ status: 'created', asset: data });
    } catch (err) {
        logger.error('studioAssets', `create-fel: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// DELETE /:id — ta bort rad + Storage-objektet
// ============================================================================
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { data: row, error } = await supabase
            .from('studio_assets').select('storage_path').eq('id', req.params.id).maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!row) return res.status(404).json({ error: 'Asset not found' });

        await supabase.storage.from(BUCKET).remove([row.storage_path]);
        const { error: delErr } = await supabase.from('studio_assets').delete().eq('id', req.params.id);
        if (delErr) return res.status(500).json({ error: delErr.message });

        logger.info('studioAssets', `Material borttaget: ${req.params.id}`);
        return res.json({ status: 'deleted' });
    } catch (err) {
        logger.error('studioAssets', `delete-fel: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

export default router;
