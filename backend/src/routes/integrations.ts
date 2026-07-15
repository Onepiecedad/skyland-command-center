/**
 * Integrations-hälsa API (SCC-37) — operatörsvy för System-fliken.
 * GET /api/v1/integrations/health → status per integration (up/down/auth_failed/not_configured).
 */

import { Router, Request, Response } from 'express';
import { checkAll } from '../services/integrationHealth';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
    const integrations = await checkAll();
    const worst = integrations.some(i => i.status === 'auth_failed' || i.status === 'down');
    res.json({ overall: worst ? 'degraded' : 'healthy', integrations, checked_at: new Date().toISOString() });
});

export default router;
