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
import { classifyAndApply } from '../services/replyClassifier';
import { addSuppression } from '../services/outreach';
import { getEmailProvider } from '../services/email';

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

// ---------------------------------------------------------------------------
// Gemensam ingest: ett inkommande mejl (oavsett leverantör) → inbox + sekvensstopp
// ---------------------------------------------------------------------------
interface InboundMail {
    fromEmail: string;
    subject: string;
    text: string;
    provider: string;
    providerEmailId?: string | null;
}

async function ingestInbound(mail: InboundMail): Promise<{ matched: boolean; contact_id?: string }> {
    const { fromEmail, subject, text, provider, providerEmailId } = mail;

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
        metadata: { from: fromEmail, subject, contact_id: contact?.id ?? null, provider, provider_email_id: providerEmailId ?? null },
        provider_message_id: providerEmailId ?? null,
    });

    // Vidarebefordra kopia till operatörens vanliga inkorg (SCC-46) — best effort
    if (config.EMAIL_FORWARD_TO) {
        try {
            await getEmailProvider().send({
                to: config.EMAIL_FORWARD_TO,
                subject: `[SCC] Svar från ${contact?.name ?? fromEmail}: ${subject}`,
                text: `Från: ${fromEmail}\nKontakt: ${contact ? `${contact.name} (matchad i CRM)` : 'ej matchad i CRM'}\n\n${text}`,
                replyTo: fromEmail,
            });
        } catch (err) {
            logger.warn('emailInbound', `kunde inte vidarebefordra kopia: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (!contact) {
        await supabase.from('activities').insert({
            customer_id: null, agent: 'system:email', event_type: 'message',
            action: 'email.inbound.unmatched', severity: 'info',
            details: { from: fromEmail, subject, provider },
        });
        return { matched: false };
    }

    // Svar mottaget → avsluta aktiva drips för kontakten (även autosvar/OOO — hellre stopp än tjat)
    await onReplyReceived(contact.id);

    await supabase.from('activities').insert({
        customer_id: contact.customer_id ?? null, agent: 'system:email', event_type: 'message',
        action: 'email.inbound.received', severity: 'info',
        details: { contact_id: contact.id, from: fromEmail, subject, provider },
    });
    // Klassa svaret och agera (plan 3.1). Best-effort: en klassificering som
    // misslyckas får aldrig göra att mejlet inte räknas som mottaget.
    await classifyAndApply({
        contactId: contact.id,
        customerId: contact.customer_id ?? null,
        fromEmail, subject, text,
    });

    logger.info('emailInbound', `svar från ${fromEmail} → kontakt ${contact.id}, drips avslutade`);
    return { matched: true, contact_id: contact.id };
}

/** Resend Inbound: webhooken bär bara metadata — kroppen hämtas via API. */
async function fetchResendReceivedText(emailId: string): Promise<string> {
    if (!config.RESEND_API_KEY) return '';
    const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` },
    });
    if (!r.ok) {
        logger.warn('emailInbound', `Resend receiving GET ${emailId} → HTTP ${r.status}`);
        return '';
    }
    const d = (await r.json()) as { text?: string | null; html?: string | null };
    if (d.text && d.text.trim()) return d.text;
    if (d.html) return d.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    return '';
}

async function handleBounce(type: string, data: Record<string, unknown>): Promise<string[]> {
    const kindMap: Record<string, { reason: string; status: string }> = {
        'email.bounced': { reason: 'bounce', status: 'bounced' },
        'email.complained': { reason: 'complaint', status: 'complained' },
    };
    const mapped = kindMap[type];
    const toList = Array.isArray(data.to) ? data.to : [data.to];
    const emails = toList.map(extractEmail).filter((e): e is string => !!e);
    for (const email of emails) {
        await addSuppression('email', email, mapped.reason, 'resend_webhook');
    }
    const providerId = typeof data.email_id === 'string' ? data.email_id : null;
    if (providerId) {
        await supabase.from('messages').update({ status: mapped.status }).eq('provider_message_id', providerId);
    }
    await supabase.from('activities').insert({
        customer_id: null, agent: 'system:email', event_type: 'message',
        action: `email.${mapped.reason}`, severity: 'warn',
        details: { emails, provider_message_id: providerId, type },
    });
    logger.warn('emailInbound', `${type}: ${emails.join(', ')} → suppression_list`);
    return emails;
}

/** Leverans- och engagemangshändelser från Resend.
 *
 * De här kastades tidigare med ett 200 och ett axelryck. Konsekvensen syntes
 * 5 sep 2026: sju kliniker hade fått öppnaren, ingen hade svarat, och det gick
 * inte att skilja "ingen öppnade" från "ingen mätte". Systemet hade aldrig
 * frågat. Nu registreras händelserna på utskicket självt.
 *
 * `status` rörs INTE. Den beskriver vad VI gjorde (sent/shadow/bounced);
 * det här är vad MOTTAGAREN gjorde. Blandas de blir båda oläsbara.
 *
 * Om öppningssiffror: de överdriver alltid. Apple Mail Privacy Protection och
 * många företagsfilter hämtar bilder automatiskt, vilket registreras som en
 * öppning ingen människa gjort. En hög siffra betyder därför lite. En NOLLA
 * över en hel batch betyder desto mer — och det var den frågan vi inte kunde
 * ställa. Leveranshändelsen är däremot hårddata.
 */
const ENGAGEMENT: Record<string, 'delivered' | 'opened' | 'clicked' | 'delayed'> = {
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.delivery_delayed': 'delayed',
};

async function handleEngagement(type: string, data: Record<string, unknown>): Promise<boolean> {
    const kind = ENGAGEMENT[type];
    const providerId = typeof data.email_id === 'string' ? data.email_id : null;
    if (!kind || !providerId) return false;

    const { data: msg, error } = await supabase
        .from('messages').select('id, metadata')
        .eq('provider_message_id', providerId).maybeSingle();
    if (error || !msg) return false;  // händelse för ett utskick vi inte äger

    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const prev = typeof meta[`${kind}_count`] === 'number' ? (meta[`${kind}_count`] as number) : 0;

    const { error: uErr } = await supabase.from('messages').update({
        metadata: {
            ...meta,
            [`${kind}_at`]: meta[`${kind}_at`] ?? now,   // första gången vinner
            [`${kind}_last_at`]: now,
            [`${kind}_count`]: prev + 1,
        },
    }).eq('id', msg.id);
    if (uErr) { logger.warn('emailInbound', `kunde inte spara ${type}: ${uErr.message}`); return false; }
    return true;
}

/**
 * POST /inbound — EN webhook-URL för allt från Resend:
 *   email.received   → hämta kropp via API → ingest (inbox, sekvensstopp, vidarebefordran)
 *   email.bounced / email.complained → suppression_list + markera utskicket
 *   email.delivered / opened / clicked / delivery_delayed → registreras på
 *     utskicket (metadata: *_at, *_last_at, *_count) — status rörs inte
 *   email.sent och okända typer → ignoreras (200)
 * Generiska leverantörer (Postmark/Mailgun-liknande payload med from/subject/text)
 * fungerar fortfarande: saknas `type` tolkas kroppen som ett komplett mejl.
 */
router.post('/inbound', inboundAuth, async (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const type = typeof body.type === 'string' ? body.type : '';
        const data = (body.data as Record<string, unknown>) ?? {};

        if (type === 'email.bounced' || type === 'email.complained') {
            const emails = await handleBounce(type, data);
            return res.status(200).json({ status: 'suppressed', emails });
        }
        if (ENGAGEMENT[type]) {
            const recorded = await handleEngagement(type, data);
            return res.status(200).json({ status: recorded ? 'recorded' : 'ignored', type });
        }
        if (type && type !== 'email.received') {
            return res.status(200).json({ status: 'ignored', type });
        }

        let fromEmail: string | null;
        let subject: string;
        let text: string;
        let providerEmailId: string | null = null;
        let provider = 'email_inbound';

        if (type === 'email.received') {
            provider = 'resend_inbound';
            fromEmail = extractEmail(data.from);
            subject = String(data.subject ?? '(inget ämne)');
            providerEmailId = typeof data.email_id === 'string' ? data.email_id : null;
            text = providerEmailId ? await fetchResendReceivedText(providerEmailId) : '';
        } else {
            const fromRaw = pick(body, ['from', 'sender', 'From']);
            fromEmail = extractEmail(fromRaw) ?? extractEmail((pick(body, ['envelope']) as Record<string, unknown>)?.from);
            subject = String(pick(body, ['subject', 'Subject']) ?? '(inget ämne)');
            text = String(pick(body, ['text', 'plain', 'body', 'html']) ?? '');
        }

        if (!fromEmail) {
            logger.warn('emailInbound', 'inkommande mejl utan avsändaradress, ignorerat');
            return res.status(200).json({ status: 'ignored', reason: 'no_from' });
        }
        // Egna utskick som studsar tillbaka / loopar: ignorera avsändare på send-domänen
        if (config.EMAIL_FROM && extractEmail(config.EMAIL_FROM) === fromEmail) {
            return res.status(200).json({ status: 'ignored', reason: 'self' });
        }

        const result = await ingestInbound({ fromEmail, subject, text, provider, providerEmailId });
        return res.status(200).json({ status: 'logged', ...result });
    } catch (err) {
        logger.error('emailInbound', `fel: ${err instanceof Error ? err.message : err}`);
        // 200 ändå så leverantören inte spammar retries; felet är loggat
        return res.status(200).json({ status: 'error_logged' });
    }
});

/** Alias (bakåtkompatibelt): bounce/complaint-webhook. Samma hanterare som /inbound. */
router.post('/events', inboundAuth, async (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const type = String(body.type ?? '');
        const data = (body.data as Record<string, unknown>) ?? {};
        if (type !== 'email.bounced' && type !== 'email.complained') {
            return res.status(200).json({ status: 'ignored', type });
        }
        const emails = await handleBounce(type, data);
        return res.status(200).json({ status: 'suppressed', emails });
    } catch (err) {
        logger.error('emailInbound', `events-fel: ${err instanceof Error ? err.message : err}`);
        return res.status(200).json({ status: 'error_logged' });
    }
});

export default router;
