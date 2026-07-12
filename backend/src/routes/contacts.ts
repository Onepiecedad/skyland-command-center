import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { logger } from '../services/logger';

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
}).strict();

router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
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

export default router;
