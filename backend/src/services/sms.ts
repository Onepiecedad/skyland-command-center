/**
 * SMS-service (F2 SCC-31 / SEQ-5) — 46elks-adapter, samma mönster som email.ts.
 * Byt leverantör = ny klass + factory-rad. E.164-normalisering är ren och testas utan nät.
 */

import { config } from '../config';

export interface OutboundSms {
    to: string;
    text: string;
    from?: string;
}
export interface SmsSendResult {
    providerMessageId: string;
}
export interface SmsProvider {
    send(sms: OutboundSms): Promise<SmsSendResult>;
}

// ============================================================================
// E.164-normalisering (svenska nummer är blandade format i datan)
// ============================================================================

export function normalizeE164(raw: string, defaultCc = '46'): string {
    const s = String(raw ?? '').replace(/[\s\-().]/g, '');
    if (!s) throw new Error('tomt telefonnummer');
    if (s.startsWith('+')) return s;
    if (s.startsWith('00')) return '+' + s.slice(2);           // 0046... → +46...
    if (s.startsWith('0')) return '+' + defaultCc + s.slice(1); // 070... → +4670...
    if (s.startsWith(defaultCc)) return '+' + s;               // 4670... → +4670...
    return '+' + s;                                            // fallback: anta landsnummer
}

// ============================================================================
// 46elks form-payload (ren funktion — enhetstestas)
// ============================================================================

export interface ElksForm { from: string; to: string; message: string; }

export function buildElksForm(sms: OutboundSms, defaults: { from: string }): ElksForm {
    const from = sms.from || defaults.from;
    if (!from) throw new Error('SMS-avsändare saknas: sätt SMS_FROM');
    if (!sms.text?.trim()) throw new Error('SMS-text saknas');
    return { from, to: normalizeE164(sms.to), message: sms.text };
}

// ============================================================================
// 46elks-provider
// ============================================================================

class ElksProvider implements SmsProvider {
    constructor(private user: string, private pass: string) {}

    async send(sms: OutboundSms): Promise<SmsSendResult> {
        const form = buildElksForm(sms, { from: config.SMS_FROM || '' });
        const body = new URLSearchParams({ from: form.from, to: form.to, message: form.message });
        const auth = Buffer.from(`${this.user}:${this.pass}`).toString('base64');

        const res = await fetch('https://api.46elks.com/a1/sms', {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`46elks ${res.status}: ${t.slice(0, 300)}`);
        }
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { providerMessageId: json.id || 'unknown' };
    }
}

export function getSmsProvider(): SmsProvider {
    if (!config.ELKS_API_USERNAME || !config.ELKS_API_PASSWORD) {
        throw new Error('SMS ej konfigurerat: sätt ELKS_API_USERNAME + ELKS_API_PASSWORD');
    }
    return new ElksProvider(config.ELKS_API_USERNAME, config.ELKS_API_PASSWORD);
}
