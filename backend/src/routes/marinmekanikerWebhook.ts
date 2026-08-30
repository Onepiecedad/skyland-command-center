/**
 * MarinMekaniker ordernotifiering (SCC-47) — ersätter n8n-flödet
 * "MarinMekaniker Ordernotifiering" som dog när n8n stängdes.
 *
 * marinmekaniker.nu (Netlify-funktionen orders.js) POST:ar en order hit.
 * Två mejl går ut via Resend: ett till Thomas (info@marinmekaniker.nu) med
 * hela ordern, ett bekräftelsemejl till kunden om e-post finns.
 *
 * Mallarna är portade ordagrant från n8n-flödet (marinmekanikerTemplates.ts).
 * Avsändare: MM_EMAIL_FROM (default Skylands send-domän, eftersom
 * marinmekaniker.nu inte är verifierad i Resend) med reply-to info@marinmekaniker.nu.
 *
 * Auth: token i ?token= eller Bearer (MM_ORDER_WEBHOOK_TOKEN, fallback LEADS_INTAKE_TOKEN).
 * Monteras FÖRE global auth.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';
import { getEmailProvider } from '../services/email';
import { THOMAS_HTML, KUND_HTML } from './marinmekanikerTemplates';

const router = Router();

const THOMAS_EMAIL = 'info@marinmekaniker.nu';

function auth(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.MM_ORDER_WEBHOOK_TOKEN || process.env.LEADS_INTAKE_TOKEN || config.SCC_API_TOKEN;
    const bearer = (req.headers.authorization || '').split(' ')[1];
    const token = bearer || (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token || token !== expected) {
        res.status(401).json({ error: 'Ogiltig eller saknad token' });
        return;
    }
    next();
}

const orderSchema = z.object({
    order_id: z.union([z.string(), z.number()]).transform(String),
    namn: z.string().min(1),
    email: z.string().email().nullish(),
    telefon: z.string().nullish(),
    motor_typ: z.string().nullish(),
    marke: z.string().nullish(),
    modell: z.string().nullish(),
    arsmodell: z.union([z.string(), z.number()]).nullish().transform(v => (v == null ? null : String(v))),
    motornummer: z.string().nullish(),
    service_interval: z.union([z.string(), z.number()]).nullish().transform(v => (v == null ? null : String(v))),
    bild_url: z.string().nullish(),
    created_at: z.string().nullish(),
}).passthrough();

function esc(v: unknown): string {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function render(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

export function buildOrderMails(o: z.infer<typeof orderSchema>): { thomas: { subject: string; html: string; text: string }; kund: { subject: string; html: string; text: string } | null } {
    const inkommen = o.created_at ? new Date(o.created_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }) : new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const vars: Record<string, string> = {
        order_id: esc(o.order_id), namn: esc(o.namn), email: esc(o.email), telefon: esc(o.telefon),
        motor_typ: esc(o.motor_typ), marke: esc(o.marke), modell: esc(o.modell), arsmodell: esc(o.arsmodell),
        motornummer: esc(o.motornummer), service_interval: esc(o.service_interval),
        bild_html: o.bild_url ? `<a href="${esc(o.bild_url)}">Visa bild</a>` : 'Ingen bild uppladdad',
        inkommen: esc(inkommen),
    };
    const motor = [o.marke, o.modell].filter(Boolean).join(' ');
    const thomasText = [
        `Ny beställning – MarinMekaniker.nu`, ``,
        `Order-ID: ${o.order_id}`, `Namn: ${o.namn}`, `E-post: ${o.email ?? '-'}`, `Telefon: ${o.telefon ?? '-'}`,
        `Motortyp: ${o.motor_typ ?? '-'}`, `Märke: ${o.marke ?? '-'}`, `Modell: ${o.modell ?? '-'}`, `Årsmodell: ${o.arsmodell ?? '-'}`,
        `Motornummer: ${o.motornummer ?? '-'}`, `Serviceintervall: ${o.service_interval ? `Vart ${o.service_interval} år` : '-'}`,
        `Bild: ${o.bild_url ?? 'Ingen bild uppladdad'}`, `Inkommen: ${inkommen}`, ``,
        `Logga in på https://marinmekaniker.nu/admin för att sätta pris och hantera ordern.`,
    ].join('\n');
    const thomas = { subject: `Ny order: ${o.namn} – ${motor}`.trim(), html: render(THOMAS_HTML, vars), text: thomasText };

    if (!o.email) return { thomas, kund: null };
    const kundText = [
        `Hej ${o.namn},`, ``,
        `Vi har tagit emot din beställning och Thomas återkommer till dig med ett prisförslag inom kort.`, ``,
        `Din beställning`, `Motor: ${motor}`, `Årsmodell: ${o.arsmodell ?? '-'}`, `Motortyp: ${o.motor_typ ?? '-'}`,
        `Serviceintervall: ${o.service_interval ? `Vart ${o.service_interval} år` : '-'}`, ``,
        `Har du frågor är du välkommen att kontakta oss: 076-855 99 31, info@marinmekaniker.nu`, ``,
        `Med vänlig hälsning,`, `Thomas Guldager`, `MarinMekaniker.nu`,
    ].join('\n');
    return { thomas, kund: { subject: 'Tack för din beställning – MarinMekaniker.nu', html: render(KUND_HTML, vars), text: kundText } };
}

router.post('/order', auth, async (req: Request, res: Response) => {
    const parsed = orderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const o = parsed.data;
    const mails = buildOrderMails(o);
    const from = process.env.MM_EMAIL_FROM || 'MarinMekaniker.nu <order@send.skylandai.se>';
    const provider = getEmailProvider();
    const sent: Record<string, string | null> = { thomas: null, kund: null };
    const errors: string[] = [];

    try {
        sent.thomas = (await provider.send({ to: THOMAS_EMAIL, from, replyTo: o.email ?? THOMAS_EMAIL, ...mails.thomas })).providerMessageId;
    } catch (err) { errors.push(`thomas: ${err instanceof Error ? err.message : err}`); }

    if (mails.kund && o.email) {
        try {
            sent.kund = (await provider.send({ to: o.email, from, replyTo: THOMAS_EMAIL, ...mails.kund })).providerMessageId;
        } catch (err) { errors.push(`kund: ${err instanceof Error ? err.message : err}`); }
    }

    await supabase.from('activities').insert({
        customer_id: null, agent: 'system:marinmekaniker', event_type: 'message',
        action: errors.length ? 'marinmekaniker.order.notify_failed' : 'marinmekaniker.order.notified',
        severity: errors.length ? 'error' : 'info',
        details: { order_id: o.order_id, namn: o.namn, email: o.email ?? null, sent, errors },
    });
    if (errors.length) {
        logger.error('marinmekaniker', `ordernotis ${o.order_id}: ${errors.join('; ')}`);
        return res.status(502).json({ ok: false, sent, errors });
    }
    logger.info('marinmekaniker', `ordernotis ${o.order_id} → Thomas${sent.kund ? ' + kund' : ''}`);
    return res.json({ ok: true, sent });
});

export default router;
