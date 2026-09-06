/**
 * Attribution API (SCC-36) — kontakt-tidslinje + trattexport.
 * Monteras under /api/v1/attribution (auth-skyddad).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
    getContactTimeline, buildFunnelRows, toCsv,
    fetchFunnelRows, aggregateFunnel, FUNNEL_GROUP_BY, type FunnelGroupBy,
    buildCommissionRows, confirmBookingPaid, overrideReplyIntent,
} from '../services/attribution';
import { logger } from '../services/logger';

const router = Router();

// GET /outreach?group_by=area|dm_vertical|dm_variant|sequence_name|score_band|none
//   &sequence=beauty&since=2026-09-01&format=csv&rows=1
// SCC-36: vilka orter/doktriner/textvarianter/poängband ger svar, intresse, möten.
// rows=1 ger råraderna (en per enrollment) i stället för aggregatet.
router.get('/outreach', async (req: Request, res: Response) => {
    const groupBy = (typeof req.query.group_by === 'string' ? req.query.group_by : 'area') as FunnelGroupBy;
    if (!FUNNEL_GROUP_BY.includes(groupBy)) {
        return res.status(400).json({ error: `group_by måste vara en av: ${FUNNEL_GROUP_BY.join(', ')}` });
    }
    try {
        const rows = await fetchFunnelRows({
            sequence: typeof req.query.sequence === 'string' ? req.query.sequence : undefined,
            since: typeof req.query.since === 'string' ? req.query.since : undefined,
        });
        const out = req.query.rows === '1' ? rows : aggregateFunnel(rows, groupBy);
        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="skyland-outreach-${groupBy}.csv"`);
            return res.send(toCsv(out as unknown as Record<string, unknown>[]));
        }
        return res.json({ group_by: groupBy, count: out.length, rows: out });
    } catch (err) {
        logger.error('attribution', `outreach: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'Kunde inte läsa outreach-tratten' });
    }
});

// GET /commission/:customerId?since=&format=csv
// SCC-39: provisionsunderlag per kund — varje bokning, vilket utskick som ledde dit,
// om den bekräftats betald och vilken provision som gäller. Bilaga till fakturan.
router.get('/commission/:customerId', async (req: Request, res: Response) => {
    try {
        const rows = await buildCommissionRows(req.params.customerId, typeof req.query.since === 'string' ? req.query.since : undefined);
        const summary = {
            bookings: rows.length,
            attributed: rows.filter(r => r.attributed).length,
            paid_confirmed: rows.filter(r => r.paid_confirmed_at).length,
            paid_value_sek: rows.reduce((s, r) => s + (r.paid_value_sek ?? 0), 0),
            commission_sek: rows.reduce((s, r) => s + (r.commission_sek ?? 0), 0),
        };
        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="skyland-provision-${req.params.customerId}.csv"`);
            return res.send(toCsv(rows as unknown as Record<string, unknown>[]));
        }
        return res.json({ customer_id: req.params.customerId, summary, rows });
    } catch (err) {
        logger.error('attribution', `commission: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'Kunde inte bygga provisionsunderlaget' });
    }
});

const confirmSchema = z.object({
    confirmed: z.boolean().default(true),
    paid_value_sek: z.number().nonnegative().nullable().optional(),
    commission_sek: z.number().nonnegative().nullable().optional(),
});

// POST /bookings/:bookingId/confirm — operatören bekräftar betald/genomförd + provision.
router.post('/bookings/:bookingId/confirm', async (req: Request, res: Response) => {
    const parsed = confirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const r = await confirmBookingPaid(req.params.bookingId, parsed.data);
    if (!r.ok) return res.status(r.error === 'Bokningen hittades inte' ? 404 : 500).json({ error: r.error });
    return res.json({ ok: true });
});

const intentSchema = z.object({
    intent: z.enum(['interested', 'no', 'autoreply', 'question', 'other']),
    note: z.string().max(500).optional(),
});

// POST /replies/:contactId/intent — operatörens facit på klassningen
// (Ambers lästes som "interested" men var ett missförstånd — det ska inte räknas som säljsvar).
router.post('/replies/:contactId/intent', async (req: Request, res: Response) => {
    const parsed = intentSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    await overrideReplyIntent(req.params.contactId, parsed.data.intent, parsed.data.note);
    return res.json({ ok: true });
});

// GET /:contactId/timeline — hela tvärkanals-historiken för en kontakt
router.get('/:contactId/timeline', async (req: Request, res: Response) => {
    const data = await getContactTimeline(req.params.contactId);
    if (!data) return res.status(404).json({ error: 'Kontakt hittades inte' });
    return res.json(data);
});

// GET /export — trattexport. ?format=csv (default json)
router.get('/export', async (req: Request, res: Response) => {
    const rows = await buildFunnelRows();
    if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="skyland-funnel.csv"');
        return res.send(toCsv(rows));
    }
    return res.json({ rows, count: rows.length });
});

export default router;
