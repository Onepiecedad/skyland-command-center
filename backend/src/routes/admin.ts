import { Router, Request, Response } from 'express';
import { reapStuckRuns } from '../services/taskService';
import { getSmsProvider, normalizeE164 } from '../services/sms';

const router = Router();

// POST /admin/reaper/run - trigger reaper manually (one-shot)
router.post('/admin/reaper/run', async (_req: Request, res: Response) => {
    try {
        await reapStuckRuns();
        return res.json({ message: 'Reaper executed successfully' });
    } catch (err) {
        console.error('Manual reaper error:', err);
        return res.status(500).json({ error: 'Reaper execution failed' });
    }
});

export default router;

// POST /admin/test-sms { to } — ett riktigt SMS genom SCC:s egen kedja
// (config → 46elks), så att "lampan är grön" kan verifieras med ett
// meddelande i handen. Bara till svenska mobilnummer; ingen loggning i
// messages, det här är inte kundkommunikation.
router.post('/admin/test-sms', async (req: Request, res: Response) => {
    const raw = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!raw) return res.status(400).json({ error: 'to krävs' });
    let to: string;
    try { to = normalizeE164(raw); } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'ogiltigt nummer' });
    }
    if (!to.startsWith('+46')) return res.status(400).json({ error: 'test-SMS bara till +46-nummer' });
    try {
        const r = await getSmsProvider().send({
            to,
            text: `SCC test-SMS ${new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}. Om du läser detta fungerar 46elks-kedjan från SCC.`,
        });
        return res.json({ ok: true, to, provider_message_id: r.providerMessageId });
    } catch (e) {
        return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'okänt fel' });
    }
});
