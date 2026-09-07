import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { logger } from '../services/logger';
import { ilikeOr } from '../utils/postgrest';

/**
 * Cold Experience — leads och konversationer.
 *
 * Till skillnad från webbleaden i routes/leads.ts, som lagras som activities,
 * är Cold Experience-leaden en egen tabell (ce_leads) med konversationer
 * (ce_conversations), meddelanden (ce_messages) och en händelselogg
 * (ce_lead_events). Listan läser vyn ce_lead_overview, som gör alla joins i SQL.
 *
 * Monteras under /api/v1, alltså efter authMiddleware och requireOperator.
 * Ingen egen auth behövs här.
 */

const router = Router();

// Tenanten är Cold Experience om inget annat anges. Slug slås upp i tenants,
// så en flytt av id:t inte kräver kodändring.
const DEFAULT_TENANT_SLUG = 'cold-experience';

async function tenantId(slug = DEFAULT_TENANT_SLUG): Promise<string | null> {
    const { data } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle();
    return data?.id ?? null;
}

// ============================================================================
// GET /stats — räknare för listhuvudet. Måste ligga före /:id.
// ============================================================================

router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const tid = await tenantId();
        if (!tid) return res.status(404).json({ error: 'tenant cold-experience saknas' });

        const { data, error } = await supabase
            .from('ce_lead_overview')
            .select('status,intent,channel,answered')
            .eq('tenant_id', tid);

        if (error) return res.status(500).json({ error: error.message });

        const rows = data ?? [];
        const tally = (key: 'status' | 'intent' | 'channel') =>
            rows.reduce<Record<string, number>>((acc, r) => {
                const k = (r as Record<string, unknown>)[key];
                const label = typeof k === 'string' && k ? k : 'okänd';
                acc[label] = (acc[label] ?? 0) + 1;
                return acc;
            }, {});

        return res.json({
            total: rows.length,
            obesvarade: rows.filter(r => !r.answered).length,
            heta_obesvarade: rows.filter(r => r.intent === 'yes' && !r.answered).length,
            per_status: tally('status'),
            per_intent: tally('intent'),
            per_kanal: tally('channel'),
        });
    } catch (err) {
        logger.error('ce-leads', `stats: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// GET / — listan. Heta och obesvarade först, sedan senast inkomna.
// ============================================================================

const listQuery = z.object({
    status: z.string().optional(),
    intent: z.enum(['yes', 'info', 'later', 'unknown']).optional(),
    channel: z.enum(['whatsapp', 'messenger', 'email', 'other']).optional(),
    country: z.string().length(2).optional(),
    answered: z.enum(['true', 'false']).optional(),
    q: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
});

router.get('/', async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({ error: 'validation failed', details: parsed.error.issues });
    }
    const p = parsed.data;

    try {
        const tid = await tenantId();
        if (!tid) return res.status(404).json({ error: 'tenant cold-experience saknas' });

        let q = supabase.from('ce_lead_overview').select('*', { count: 'exact' }).eq('tenant_id', tid);

        if (p.status) q = q.eq('status', p.status);
        if (p.intent) q = q.eq('intent', p.intent);
        if (p.channel) q = q.eq('channel', p.channel);
        if (p.country) q = q.eq('country', p.country.toUpperCase());
        if (p.answered) q = q.eq('answered', p.answered === 'true');
        // Fritext tål komma och parenteser tack vare ilikeOr, se utils/postgrest.
        if (p.q) q = q.or(ilikeOr(['name', 'email', 'phone', 'guest_message'], p.q));

        const { data, error, count } = await q
            .order('received_at', { ascending: false })
            .range(p.offset, p.offset + p.limit - 1);

        if (error) return res.status(500).json({ error: error.message });

        // Sorteringen som betyder något för Gustav: obesvarade heta överst.
        const rank = (r: Record<string, unknown>) =>
            (r.answered ? 2 : 0) + (r.intent === 'yes' ? 0 : r.intent === 'info' ? 0.4 : 0.8);
        const leads = (data ?? []).slice().sort((a, b) => rank(a) - rank(b));

        return res.json({ leads, count: count ?? leads.length, limit: p.limit, offset: p.offset });
    } catch (err) {
        logger.error('ce-leads', `list: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// GET /:id — ett lead med hela tråden och händelseloggen
// ============================================================================

router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { data: lead, error } = await supabase
            .from('ce_lead_overview').select('*').eq('id', req.params.id).maybeSingle();

        if (error) return res.status(500).json({ error: error.message });
        if (!lead) return res.status(404).json({ error: 'lead saknas' });

        const [convRes, msgRes, evtRes] = await Promise.all([
            supabase.from('ce_conversations').select('*')
                .eq('lead_id', lead.id).order('created_at', { ascending: false }),
            supabase.from('ce_messages')
                .select('id,conversation_id,direction,sender,channel,body,status,error,created_at')
                .eq('lead_id', lead.id).order('created_at', { ascending: true }).limit(200),
            supabase.from('ce_lead_events')
                .select('id,event_type,from_status,to_status,actor,payload,created_at')
                .eq('lead_id', lead.id).order('created_at', { ascending: true }).limit(200),
        ]);

        return res.json({
            lead,
            conversations: convRes.data ?? [],
            messages: msgRes.data ?? [],
            events: evtRes.data ?? [],
        });
    } catch (err) {
        logger.error('ce-leads', `detail: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

// ============================================================================
// PATCH /:id — flytta ett lead eller anteckna. Skriver även en händelse,
// så loggen visar att en människa gjorde det och inte agenten.
// ============================================================================

const patchSchema = z.object({
    status: z.enum(['new', 'in_conversation', 'qualifying', 'handed_off', 'booked', 'cold', 'lost']).optional(),
    notes: z.string().max(4000).nullish(),
}).strict().refine(o => o.status !== undefined || o.notes !== undefined, {
    message: 'ange status eller notes',
});

router.patch('/:id', async (req: Request, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'validation failed', details: parsed.error.issues });
    }

    try {
        const { data: before, error: readErr } = await supabase
            .from('ce_leads').select('id,tenant_id,status').eq('id', req.params.id).maybeSingle();
        if (readErr) return res.status(500).json({ error: readErr.message });
        if (!before) return res.status(404).json({ error: 'lead saknas' });

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (parsed.data.status !== undefined) patch.status = parsed.data.status;
        if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;

        const { data, error } = await supabase
            .from('ce_leads').update(patch).eq('id', req.params.id).select('*').single();
        if (error) return res.status(500).json({ error: error.message });

        if (parsed.data.status && parsed.data.status !== before.status) {
            await supabase.from('ce_lead_events').insert({
                tenant_id: before.tenant_id,
                lead_id: before.id,
                event_type: 'status_changed',
                from_status: before.status,
                to_status: parsed.data.status,
                actor: 'human',
                payload: { via: 'scc' },
            });
        }

        logger.info('ce-leads', `lead uppdaterat: ${req.params.id}`, { falt: Object.keys(patch) });
        return res.json({ status: 'updated', lead: data });
    } catch (err) {
        logger.error('ce-leads', `patch: ${err instanceof Error ? err.message : String(err)}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

export default router;
