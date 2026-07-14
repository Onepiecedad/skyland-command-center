/**
 * E-postservice (SCC-30) — provider-adapter, samma mönster som LLM-lagret.
 * Idag: Resend. Byt leverantör = ny klass + factory-rad, inget annat.
 */

import { config } from '../config';

export interface OutboundEmail {
    to: string;
    subject: string;
    text: string;
    from?: string;
    replyTo?: string;
}

export interface SendResult {
    providerMessageId: string;
}

export interface EmailProvider {
    send(email: OutboundEmail): Promise<SendResult>;
}

// ============================================================================
// Payload-mappning (ren funktion — enhetstestas utan nätverk)
// ============================================================================

export interface ResendPayload {
    from: string;
    to: string[];
    subject: string;
    text: string;
    reply_to?: string;
}

export function buildResendPayload(email: OutboundEmail, defaults: { from: string; replyTo?: string }): ResendPayload {
    const from = email.from || defaults.from;
    if (!from) throw new Error('Avsändare saknas: sätt EMAIL_FROM eller ange from explicit');
    if (!email.to || !email.to.includes('@')) throw new Error(`Ogiltig mottagaradress: "${email.to}"`);
    if (!email.subject?.trim()) throw new Error('Ämnesrad saknas');
    if (!email.text?.trim()) throw new Error('Meddelandetext saknas');

    const payload: ResendPayload = {
        from,
        to: [email.to.trim()],
        subject: email.subject.trim(),
        text: email.text,
    };
    const replyTo = email.replyTo || defaults.replyTo;
    if (replyTo) payload.reply_to = replyTo;
    return payload;
}

// ============================================================================
// Resend-provider
// ============================================================================

class ResendProvider implements EmailProvider {
    constructor(private apiKey: string) {}

    async send(email: OutboundEmail): Promise<SendResult> {
        const payload = buildResendPayload(email, {
            from: config.EMAIL_FROM || '',
            replyTo: config.EMAIL_REPLY_TO,
        });

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
        }

        const data = (await res.json()) as { id?: string };
        if (!data.id) throw new Error('Resend svarade utan message-id');
        return { providerMessageId: data.id };
    }
}

// ============================================================================
// Factory
// ============================================================================

export function getEmailProvider(): EmailProvider {
    switch (config.EMAIL_PROVIDER) {
        case 'resend': {
            if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY saknas i env');
            return new ResendProvider(config.RESEND_API_KEY);
        }
        default:
            throw new Error(`Okänd e-postleverantör: ${config.EMAIL_PROVIDER}`);
    }
}
