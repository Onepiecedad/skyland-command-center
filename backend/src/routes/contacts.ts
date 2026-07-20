import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { logger } from '../services/logger';
import { getAdapter } from '../llm/adapter';
import { VOICE_PROFILE } from '../llm/voiceProfile';

/**
 * Contacts API (SCC-23 / SCC-26, F1: CRM-kärnan)
 *
 * The normalized contact entity that leads become. Mounted under
 * /api/v1/contacts behind the global authMiddleware (see server.ts), so no
 * per-route auth is needed here.
 */

const router = Router();

const STATUS = ['new', 'working', 'qualified', 'won', 'lost'] as const;

// ============================================================================
// GET / — list contacts (newest first), optional status filter + search
// ============================================================================
router.get('/', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
        const status = typeof req.query.status === 'string' ? req.query.status : null;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;

        let query = supabase
            .from('contacts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status && (STATUS as readonly string[]).includes(status)) {
            query = query.eq('status', status);
        }
        if (search) {
            query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);
        }

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ contacts: data, count: data?.length || 0 });
    } catch (err) {
        console.error('[Contacts] list error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /:id — single contact
// ============================================================================
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('contacts')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error || !data) return res.status(404).json({ error: 'Contact not found' });
        return res.json({ contact: data });
    } catch (err) {
        console.error('[Contacts] get error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST / — create a contact (used by discover_pipeline for prospecting intake)
// ============================================================================
const createSchema = z.object({
    name: z.string().min(1),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    company: z.string().nullish(),
    website: z.string().nullish(),
    status: z.enum(STATUS).optional(),
    source: z.string().nullish(),
    tags: z.array(z.string()).optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
}).strict();

router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const { data, error } = await supabase
            .from('contacts')
            .insert({ ...parsed.data, status: parsed.data.status ?? 'new' })
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });

        logger.info('contacts', `Contact created: ${data.id} (${data.name})`, { source: data.source });
        return res.status(201).json({ status: 'created', contact: data });
    } catch (err) {
        console.error('[Contacts] create error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PATCH /:id — edit contact fields
// ============================================================================
const patchSchema = z.object({
    name: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    company: z.string().nullish(),
    website: z.string().nullish(),
    status: z.enum(STATUS).optional(),
    tags: z.array(z.string()).optional(),
    // custom MERGAS med befintligt jsonb (skriver aldrig över score/tier/booking_flow
    // med ett partiellt objekt) — används bl.a. för dm_hook från Alex-research.
    custom: z.record(z.string(), z.unknown()).optional(),
}).strict();

router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const patch: Record<string, unknown> = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Merga custom med befintligt värde istället för att ersätta hela objektet
        if (patch.custom) {
            const { data: existing, error: exErr } = await supabase
                .from('contacts')
                .select('custom')
                .eq('id', req.params.id)
                .maybeSingle();
            if (exErr) return res.status(500).json({ error: exErr.message });
            if (!existing) return res.status(404).json({ error: 'Contact not found' });
            patch.custom = { ...(existing.custom as Record<string, unknown> ?? {}), ...(patch.custom as Record<string, unknown>) };
        }

        const { data, error } = await supabase
            .from('contacts')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Contact not found' });

        logger.info('contacts', `Contact updated: ${req.params.id}`, { fields: Object.keys(patch) });
        return res.json({ status: 'updated', contact: data });
    } catch (err) {
        console.error('[Contacts] patch error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /:id — remove a contact and its opportunities (manual CRM cleanup)
// ============================================================================
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { error: oppErr } = await supabase
            .from('opportunities')
            .delete()
            .eq('contact_id', req.params.id);
        if (oppErr) return res.status(500).json({ error: oppErr.message });

        const { data, error } = await supabase
            .from('contacts')
            .delete()
            .eq('id', req.params.id)
            .select('id')
            .maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Contact not found' });

        logger.info('contacts', `Contact deleted: ${req.params.id}`);
        return res.json({ status: 'deleted' });
    } catch (err) {
        console.error('[Contacts] delete error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /:id/conversation — SCC-26 unified inbox: all messages for a contact,
// across every channel, as one time-ordered thread.
//
// messages has no contact_id column yet, so we resolve the contact's linked
// conversations two ways: (1) messages whose metadata.contact_id matches, and
// (2) messages sharing the contact's session_uuid via metadata. Newest schema
// wins; this is intentionally permissive so nothing is dropped from the thread.
// ============================================================================
router.get('/:id/conversation', async (req: Request, res: Response) => {
    try {
        const { data: contact, error: cErr } = await supabase
            .from('contacts')
            .select('id, name, custom')
            .eq('id', req.params.id)
            .single();
        if (cErr || !contact) return res.status(404).json({ error: 'Contact not found' });

        const custom = (contact.custom || {}) as Record<string, unknown>;
        const sessionUuid = typeof custom.session_uuid === 'string' ? custom.session_uuid : null;

        const orClauses = [`metadata->>contact_id.eq.${contact.id}`];
        if (sessionUuid) orClauses.push(`metadata->>session_uuid.eq.${sessionUuid}`);

        const { data: messages, error: mErr } = await supabase
            .from('messages')
            .select('*')
            .or(orClauses.join(','))
            .order('created_at', { ascending: true })
            .limit(500);
        if (mErr) return res.status(500).json({ error: mErr.message });

        return res.json({
            contact,
            messages: messages || [],
            count: messages?.length || 0,
        });
    } catch (err) {
        console.error('[Contacts] conversation error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /:id/draft-reply — generera ett svarsutkast i Joakims röst utifrån
// konversationen. Returnerar { draft }. Operatören granskar och skickar själv.
// ============================================================================
router.post('/:id/draft-reply', async (req: Request, res: Response) => {
    try {
        const { data: contact, error: cErr } = await supabase
            .from('contacts').select('id, name, custom').eq('id', req.params.id).single();
        if (cErr || !contact) return res.status(404).json({ error: 'Contact not found' });

        const custom = (contact.custom || {}) as Record<string, unknown>;
        const sessionUuid = typeof custom.session_uuid === 'string' ? custom.session_uuid : null;
        const orClauses = [`metadata->>contact_id.eq.${contact.id}`];
        if (sessionUuid) orClauses.push(`metadata->>session_uuid.eq.${sessionUuid}`);

        const { data: messages } = await supabase
            .from('messages').select('direction, content, created_at')
            .or(orClauses.join(','))
            .order('created_at', { ascending: true })
            .limit(40);

        const withText = (messages || []).filter((m: { content?: string }) => (m.content || '').trim());
        if (withText.length === 0) {
            return res.status(400).json({ error: 'Ingen konversation att svara på än.' });
        }

        const transcript = withText.slice(-20).map((m: { direction: string; content: string }) => {
            const who = m.direction === 'outbound' ? 'Joakim' : m.direction === 'inbound' ? 'Prospekt' : 'Notis';
            return `${who}: ${m.content}`;
        }).join('\n');

        const systemPrompt = `${VOICE_PROFILE}

UPPGIFT: Skriv Joakims NÄSTA svar i en Instagram-DM med ett prospekt (en tatuerarstudio, kontakt: ${contact.name ?? 'okänd'}). Nedan är konversationen. Skriv ENBART svaret som ska skickas — inga citattecken, ingen förklaring, ingen rubrik. Kort. Håll röstprofilen strikt: du (aldrig ni), inga tankstreck, inga klyschor, låg press, gärna en liten ja-fråga på slutet.`;

        const out = await getAdapter().chat({
            systemPrompt,
            messages: [{ role: 'user', content: transcript }],
        });

        const draft = (out.text || '').trim();
        if (!draft) return res.status(502).json({ error: 'Tomt utkast från modellen.' });

        logger.info('contacts', `draft-reply genererat för ${contact.name}`, { contact_id: contact.id });
        return res.json({ draft });
    } catch (err) {
        logger.error('contacts', `draft-reply fel: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

export default router;
