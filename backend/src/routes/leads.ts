import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabase, websiteSupabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';

/**
 * Leads Intake — website (skylandai.se) → SCC
 *
 * n8n workflows (void-submission, voice-call-ended) POST here after
 * processing a lead. Leads are stored as activities (event_type: 'lead')
 * so they appear in the ActivityLog feed and event stream.
 *
 * Auth: Bearer LEADS_INTAKE_TOKEN (falls back to SCC_API_TOKEN).
 */

const router = Router();

// ============================================================================
// Auth
// ============================================================================

function intakeAuth(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.LEADS_INTAKE_TOKEN || config.SCC_API_TOKEN;
    const header = req.headers.authorization;

    if (!header) {
        res.status(401).json({ error: 'Missing Authorization header' });
        return;
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
        res.status(401).json({ error: 'Invalid Authorization format. Expected: Bearer <token>' });
        return;
    }

    if (token !== expected) {
        res.status(403).json({ error: 'Invalid intake token' });
        return;
    }

    next();
}

// ============================================================================
// Schema — unified lead payload from both website paths
// ============================================================================

const leadIntakeSchema = z.object({
    source: z.enum(['void_form', 'voice_call']),
    // Website-side identifiers (website Supabase project)
    session_uuid: z.string().min(1),
    prospect_id: z.string().uuid().nullish(),
    // Contact
    name: z.string().nullish(),
    email: z.string().nullish(),
    company: z.string().nullish(),
    website: z.string().nullish(),
    phone: z.string().nullish(),
    // Form path
    message: z.string().nullish(),
    score: z.number().int().min(0).max(100).nullish(),
    // Voice path
    summary: z.string().nullish(),
    extracted: z.record(z.string(), z.unknown()).nullish(),
});

// ============================================================================
// POST /intake — receive a lead from the website n8n workflows
// ============================================================================

router.post('/intake', intakeAuth, async (req: Request, res: Response) => {
    try {
        const parsed = leadIntakeSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues,
            });
        }

        const lead = parsed.data;

        // Idempotency: skip if we already logged this prospect/session+source
        const dedupeKey = lead.prospect_id || lead.session_uuid;
        const { data: existing } = await supabase
            .from('activities')
            .select('id')
            .eq('event_type', 'lead')
            .eq('action', `lead.${lead.source}`)
            .contains('details', { dedupe_key: dedupeKey })
            .limit(1);

        if (existing && existing.length > 0) {
            return res.status(200).json({ status: 'duplicate', activity_id: existing[0].id });
        }

        const { data, error } = await supabase
            .from('activities')
            .insert({
                customer_id: null,
                agent: 'website',
                action: `lead.${lead.source}`,
                event_type: 'lead',
                severity: 'info',
                autonomy_level: 'OBSERVE',
                details: { ...lead, dedupe_key: dedupeKey },
            })
            .select()
            .single();

        if (error) {
            console.error('[Leads Intake] Insert failed:', error);
            return res.status(500).json({ error: error.message });
        }

        logger.info('leads', `New ${lead.source} lead: ${lead.name || lead.session_uuid}`, { email: lead.email, activity_id: data.id });

        return res.status(201).json({ status: 'accepted', activity_id: data.id });
    } catch (err) {
        console.error('[Leads Intake] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET / — list received leads (newest first)
// ============================================================================

router.get('/', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

        const { data, error } = await supabase
            .from('activities')
            .select('*')
            .eq('event_type', 'lead')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        return res.json({ leads: data, count: data?.length || 0 });
    } catch (err) {
        console.error('[Leads] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /:id/detail — full lead detail: activity + website-side data
// (prospect, interactions incl. AI responses, voice call transcripts)
// ============================================================================

router.get('/:id/detail', async (req: Request, res: Response) => {
    try {
        const { data: activity, error } = await supabase
            .from('activities')
            .select('*')
            .eq('id', req.params.id)
            .eq('event_type', 'lead')
            .single();

        if (error || !activity) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const details = (activity.details || {}) as Record<string, unknown>;
        const sessionUuid = typeof details.session_uuid === 'string' ? details.session_uuid : null;

        if (!websiteSupabase || !sessionUuid) {
            return res.json({
                activity,
                prospect: null,
                interactions: [],
                voice_calls: [],
                website_data_available: Boolean(websiteSupabase),
            });
        }

        const [prospectRes, interactionsRes, voiceCallsRes] = await Promise.all([
            websiteSupabase
                .from('prospects')
                .select('*')
                .eq('session_uuid', sessionUuid)
                .order('created_at', { ascending: false })
                .limit(1),
            websiteSupabase
                .from('interactions')
                .select('*')
                .eq('session_uuid', sessionUuid)
                .order('created_at', { ascending: true })
                .limit(50),
            websiteSupabase
                .from('voice_calls')
                .select('*')
                .eq('session_uuid', sessionUuid)
                .order('started_at', { ascending: true })
                .limit(20),
        ]);

        return res.json({
            activity,
            prospect: prospectRes.data?.[0] || null,
            interactions: interactionsRes.data || [],
            voice_calls: voiceCallsRes.data || [],
            website_data_available: true,
        });
    } catch (err) {
        console.error('[Leads Detail] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
