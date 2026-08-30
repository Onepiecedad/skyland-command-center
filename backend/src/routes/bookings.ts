/**
 * Bokningar (SCC-45-spegeln) — läs-API för kalendern.
 * Cal.com äger bokningen; SCC speglar den i `bookings` via calcomWebhook.
 * GET /api/v1/bookings?from=ISO&to=ISO  (default: 60 dagar bakåt → 120 dagar framåt)
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    const now = Date.now();
    const from = typeof req.query.from === 'string' ? req.query.from : new Date(now - 60 * 86400_000).toISOString();
    const to = typeof req.query.to === 'string' ? req.query.to : new Date(now + 120 * 86400_000).toISOString();
    const { data, error } = await supabase
        .from('bookings')
        .select('id, external_id, title, attendee_email, attendee_name, starts_at, ends_at, status, source, contact_id, customer_id, created_at')
        .gte('starts_at', from).lte('starts_at', to)
        .order('starts_at', { ascending: true }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ bookings: data ?? [] });
});

export default router;
