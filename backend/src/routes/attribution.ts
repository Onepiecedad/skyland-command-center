/**
 * Attribution API (SCC-36) — kontakt-tidslinje + trattexport.
 * Monteras under /api/v1/attribution (auth-skyddad).
 */

import { Router, Request, Response } from 'express';
import { getContactTimeline, buildFunnelRows, toCsv } from '../services/attribution';

const router = Router();

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
