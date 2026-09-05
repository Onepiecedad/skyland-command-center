/**
 * Operatörens WhatsApp-väg ut (bakom vanlig auth).
 *
 * POST /api/v1/whatsapp/send  { contact_id, text }
 *   Fritext till kontaktens WhatsApp-nummer, bara inom 24-timmarsfönstret.
 *   Utanför fönstret svarar den 409 med skälet i stället för att låta Meta
 *   avvisa det med ett fel som ser ut som ett nätfel.
 *
 * GET  /api/v1/whatsapp/window/:contactId
 *   Är fönstret öppet, och när stänger det? För kortet i CRM:et.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { sendText, lastInboundAt, serviceWindowOpen, normalizeWaId, SERVICE_WINDOW_MS } from '../services/whatsapp';

const router = Router();

const sendSchema = z.object({
    contact_id: z.string().uuid(),
    text: z.string().min(1).max(4096),
});

router.post('/send', async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const { data: contact } = await supabase
        .from('contacts').select('id, name, phone, custom, tenant_id')
        .eq('id', parsed.data.contact_id).maybeSingle();
    if (!contact) return res.status(404).json({ error: 'kontakten finns inte' });

    const waId = normalizeWaId((contact.custom as Record<string, unknown> | null)?.wa_id as string | undefined) || normalizeWaId(contact.phone);
    if (!waId) return res.status(400).json({ error: 'kontakten saknar WhatsApp-nummer' });

    const r = await sendText({ contactId: contact.id, waId, text: parsed.data.text, tenantId: contact.tenant_id, loggedBy: 'operator' });
    if (!r.ok) {
        const code = r.code === 'window_closed' ? 409 : r.code === 'disabled' || r.code === 'not_configured' ? 503 : 502;
        return res.status(code).json({ error: r.error, code: r.code });
    }
    return res.status(201).json({ status: 'sent', mid: r.mid });
});

router.get('/window/:contactId', async (req: Request, res: Response) => {
    const last = await lastInboundAt(req.params.contactId);
    const open = serviceWindowOpen(last);
    const closesAt = last && open ? new Date(Date.parse(last) + SERVICE_WINDOW_MS).toISOString() : null;
    return res.json({ open, last_inbound_at: last, closes_at: closesAt });
});

export default router;
