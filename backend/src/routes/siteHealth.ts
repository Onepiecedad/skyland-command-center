/**
 * Sajthälsa — hitta kontakter vars hemsida är trasig, parkerad eller borta.
 *
 * Ligger bakom den globala Bearer-auth:en i server.ts.
 * Skanningen gör utgående HTTP mot tredje part men kontaktar ingen — den är
 * research, inte outreach, och behöver därför ingen review-task.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { scanContactSites, listSiteHealthLeads } from '../services/siteHealthScan';
import { logger } from '../services/logger';

const router = Router();

const scanSchema = z.object({
    limit: z.number().int().min(1).max(1000).optional(),
    recheckAfterDays: z.number().int().min(0).max(365).optional(),
    dryRun: z.boolean().optional(),
}).strict();

// POST /scan — kör kontrollen och spara resultatet på kontakterna
router.post('/scan', async (req: Request, res: Response) => {
    const parsed = scanSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    try {
        const summary = await scanContactSites(parsed.data);

        // Displayer får inte ljuga: säg ifrån när nätet gör svaret oanvändbart.
        const warning = summary.scanned > 0 && summary.inconclusive / summary.scanned > 0.2
            ? 'Mer än 20 % blev INCONCLUSIVE. Kör från ett nät med vanligt rykte, ' +
              'inte från Render — datacenter-IP blockeras av WAF och friska sajter ' +
              'går då inte att bedöma.'
            : undefined;

        return res.json({ status: 'ok', summary, ...(warning ? { warning } : {}) });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('siteHealth', `Skanning misslyckades: ${message}`);
        return res.status(500).json({ error: message });
    }
});

// GET /leads — redan lagrade säljbara träffar, ingen ny nätverkstrafik
router.get('/leads', async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 100);
    try {
        const leads = await listSiteHealthLeads(Number.isFinite(limit) ? limit : 100);
        return res.json({ count: leads.length, leads });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: message });
    }
});

export default router;
