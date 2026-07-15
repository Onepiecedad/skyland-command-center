/**
 * Merge API (GHL-härledd SCC-41). POST /api/v1/merge/contacts { keep_id, remove_id }
 * Slår ihop två kontakter utan dataförlust. Auth-skyddad globalt.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { mergeContacts } from '../services/contactMerge';

const router = Router();

const schema = z.object({
    keep_id: z.string().uuid(),
    remove_id: z.string().uuid(),
});

router.post('/contacts', async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    try {
        const result = await mergeContacts(parsed.data.keep_id, parsed.data.remove_id);
        return res.json({ status: 'merged', ...result });
    } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'merge misslyckades' });
    }
});

export default router;
