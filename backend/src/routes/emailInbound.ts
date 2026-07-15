/**
 * Inkommande mejl (SCC-43) — webhook för mottagna svar.
 *
 * En mejl-leverantör med inbound (Resend Inbound / Postmark / Mailgun) POST:ar hit.
 * Vi matchar avsändaren mot en kontakt, loggar mejlet i unified inbox (messages,
 * direction=inbound) och triggar `reply_received` → aktiva drips för kontakten avslutas.
 *
 * Monteras FÖRE global auth (som /leads). Egen token: EMAIL_INBOUND_TOKEN
 * (Bearer eller ?token=), fallback SCC_API_TOKEN.
 * TODO: byt till leverantörens signaturverifiering (Svix för Resend) när skarp.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';
import { onReplyReceived } from '../services/sequenceEvents';

const router = Router();

function inboundAuth(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.EMAIL_INBOUND_TOKEN || config.SCC_API_TOKEN;
    const bearer = (req.headers.authorization || '').split(' ')[1];
    const token = bearer || (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token || token !== expected) {
        res.status(401).json({ error: 'Ogiltig eller saknad inbound-token' });
        return;
    }
    next();
}

/** Plocka ut en e-postadress ur en sträng som "Namn <a@b.se>" eller "a@b.se". */
function extractEmail(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const m = v.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0].toLowerCase() : null;
}

/** Flexibel fält-plockning över olika leverantörsformat. */
function pick(body: Record<string, unknown>, keys: string[]): unknown {
    const data = (body.data as Record<string, unknown>) ?? {};
    for (const k of keys) {
        if (body[k] !== undefined) return body[k];
        if (data[k] !== undefined) return data[k];
    }
    return undefined;
}

router.post('/inbound', inboundAuth, async (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;

        const fromRaw = pick(body, ['from', 'sender', 'From']);
        const fromEmail = extractEmail(fromRaw) ?? extractEmail((pick(body, ['envelope']) as Record<string, unknown>)?.from);
        const subject = String(pick(body, ['subject', 'Subject']) ?? '(inget ämne)');
        const text = String(pick(body, ['text', 'plain', 'body', 'html']) ?? '');

        if (!fromEmail) {
            logger.warn('emailInbound', 'inkommande mejl utan avsändaradress, ignorerat');
            return res.status(200).json({ status: 'ignored', reason: 'no_from' });
        }

        // Matcha kontakt (email-kolumn eller custom.email), case-insensitivt
        const { data: contacts } = await supabase
            .from('contacts')
            .select('id, name, customer_id, email, custom')
            .or(`email.ilike.${fromEmail},custom->>email.ilike.${fromEmail}`)
            .limit(1);
        const contact = (contacts ?? [])[0] as
            | { id: string; name: string | null; customer_id: string | null }
            | undefined;

        // Logga alltid mejlet (inbox) — med kontaktlänk om vi hittade en
        await supabase.from('messages').insert({
            customer_id: contact?.customer_id ?? null,
            role: 'user',
            channel: 'email',
            direction: 'inbound',
            content: `${subject}\n\n${text}`.slice(0, 20000),
            metadata: { from: fromEmail, subject, contact_id: contact?.id ?? null, provider: 'email_inbound' },
        });

        if (!contact) {
            await supabase.from('activities').insert({
                customer_id: null, agent: 'system:email', event_type: 'message',
                action: 'email.inbound.unmatched', severity: 'info',
                details: { from: fromEmail, subject },
            });
            return res.status(200).json({ status: 'logged', matched: false });
        }

        // Svar mottaget → avsluta aktiva drips för kontakten
        await onReplyReceived(contact.id);

        await supabase.from('activities').insert({
            customer_id: contact.customer_id ?? null, agent: 'system:email', event_type: 'message',
            action: 'email.inbound.received', severity: 'info',
            details: { contact_id: contact.id, from: fromEmail, subject },
        });

        logger.info('emailInbound', `svar från ${fromEmail} → kontakt ${contact.id}, drips avslutade`);
        return res.status(200).json({ status: 'logged', matched: true, contact_id: contact.id });
    } catch (err) {
        logger.error('emailInbound', `fel: ${err instanceof Error ? err.message : err}`);
        // 200 ändå så leverantören inte spammar retries; felet är loggat
        return res.status(200).json({ status: 'error_logged' });
    }
});

export default router;
