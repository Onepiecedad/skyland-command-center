/**
 * UI-styrning över HTTP — så att Alex på VPS:en kan visa saker på skärmen.
 *
 * Panelens Alex äger skärmen för att SSE-kanalen bara går från backenden till
 * webbläsaren. Gateway-Alex på VPS:en har alla skills men satt utanför den
 * kanalen, och kunde därför aldrig peka på något. Den når däremot SCC över
 * internet, så den vägen är öppen: samma verktyg som panelens Alex använder,
 * exponerat som en endpoint.
 *
 * Medvetet BARA skärmen. Den här ingången ändrar ingen data — vill VPS-Alex
 * ändra något gör den det med scc-crm-skillen mot de vanliga API:erna, där
 * behörigheter och loggning redan finns.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { executeToolCall } from '../llm/tools';
import { logger } from '../services/logger';

const router = Router();

/** Endast skärmverktyg. Listan är hela behörigheten för den här ingången. */
const SKARM_VERKTYG = ['navigate_ui', 'present_screens'] as const;

const schema = z.object({
    verktyg: z.enum(SKARM_VERKTYG).default('navigate_ui'),
    args: z.record(z.unknown()).default({}),
});

router.post('/', async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validering misslyckades', details: parsed.error.issues });
    }
    const { verktyg, args } = parsed.data;

    try {
        const result = await executeToolCall(verktyg, args as Record<string, unknown>);
        logger.info('ui', `${verktyg} via HTTP: ${result.success ? 'ok' : result.error}`);
        return res.status(result.success ? 200 : 409).json(result);
    } catch (err) {
        logger.error('ui', `${verktyg} kastade: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'Internt fel' });
    }
});

export default router;
