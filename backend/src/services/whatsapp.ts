/**
 * WhatsApp Cloud API — tolkning av Metas webhook, signaturkontroll, 24-timmars-
 * fönstret och utgående text. Första externa tenanten (Cold Experience) tar
 * emot sina leads här: kunden skriver in via WhatsApp (CTWA-annons eller
 * direkt), och kortet, tråden och attributionen skapas i det VANLIGA CRM:et —
 * samma kontakter, kort och meddelanden som tattoo och beauty. Ingen
 * parallell datamodell.
 *
 * Det som är WhatsApp-specifikt och som INTE finns i mejl/IG-flödena:
 *
 * - Signaturen. Meta signerar varje POST med HMAC-SHA256 över råkroppen
 *   (X-Hub-Signature-256). Utan app-hemligheten går den inte att kontrollera,
 *   och då accepteras bara Bearer-token (test/manuell väg).
 * - 24-timmarsfönstret. Fritext får bara skickas inom 24 h från kundens
 *   senaste meddelande. Utanför fönstret måste det vara en godkänd mall.
 *   Räknas ur tråden — ingen egen tabell behövs.
 * - Annonsattributionen. Ett CTWA-meddelande bär `referral` (source_id,
 *   ctwa_clid, headline). Det är den raden provisionsfakturan vilar på, så den
 *   sparas vid FÖRSTA beröringen och skrivs aldrig över.
 *
 * Rena funktioner ligger överst (testbara utan databas); allt som rör
 * Supabase och nätet ligger under.
 */

import crypto from 'crypto';
import { supabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Typer för det Meta skickar (bara fälten vi läser)
// ---------------------------------------------------------------------------

export interface WaReferral {
    source_url?: string;
    source_type?: string;   // 'ad' | 'post'
    source_id?: string;     // annons-id
    headline?: string;
    body?: string;
    media_type?: string;
    ctwa_clid?: string;
}

interface WaMessage {
    from: string;           // wa_id, E.164 utan plus
    id: string;             // wamid.…
    timestamp: string;      // unix-sekunder som sträng
    type: string;
    text?: { body: string };
    image?: { id: string; caption?: string; mime_type?: string };
    audio?: { id: string; mime_type?: string; voice?: boolean };
    video?: { id: string; caption?: string };
    document?: { id: string; filename?: string; caption?: string };
    sticker?: { id: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: unknown[];
    button?: { text?: string; payload?: string };
    interactive?: {
        type?: string;
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string; description?: string };
    };
    reaction?: { message_id?: string; emoji?: string };
    referral?: WaReferral;
    context?: { from?: string; id?: string };
    errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface WaStatus {
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed' | string;
    timestamp: string;
    recipient_id?: string;
    conversation?: { id?: string; origin?: { type?: string }; expiration_timestamp?: string };
    pricing?: { billable?: boolean; category?: string; pricing_model?: string };
    errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface WaChangeValue {
    messaging_product?: string;
    metadata?: { display_phone_number?: string; phone_number_id?: string };
    contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
    messages?: WaMessage[];
    statuses?: WaStatus[];
}

export interface WaWebhookBody {
    object?: string;
    entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WaChangeValue }> }>;
}

/** Ett inkommande meddelande, normaliserat till det tråden behöver. */
export interface InboundEvent {
    kind: 'message';
    phoneNumberId: string;      // vilket företagsnummer det kom in på (→ tenant)
    waId: string;               // avsändarens nummer utan plus
    profileName: string | null;
    mid: string;
    at: string;                 // ISO
    type: string;
    text: string;               // läsbar representation, aldrig tom
    mediaId: string | null;
    referral: WaReferral | null;
    replyToMid: string | null;
}

export interface StatusEvent {
    kind: 'status';
    phoneNumberId: string;
    mid: string;
    status: string;
    at: string;
    recipientWaId: string | null;
    conversationOrigin: string | null;
    error: string | null;
}

export type WaEvent = InboundEvent | StatusEvent;

// ---------------------------------------------------------------------------
// Rena funktioner
// ---------------------------------------------------------------------------

/** Metas signatur: "sha256=" + HMAC-SHA256(app secret, råkropp). Tidssäker jämförelse. */
export function verifySignature(rawBody: Buffer | string | undefined, header: string | undefined, appSecret: string): boolean {
    if (!rawBody || !header || !appSecret) return false;
    const given = header.startsWith('sha256=') ? header.slice(7) : header;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    if (given.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
}

function isoFromUnix(ts: string | undefined): string {
    const n = Number(ts);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/** Läsbar text för alla meddelandetyper. Tråden ska aldrig visa en tom rad. */
export function describeMessage(m: WaMessage): { text: string; mediaId: string | null } {
    switch (m.type) {
        case 'text':
            return { text: (m.text?.body ?? '').trim() || '[tomt textmeddelande]', mediaId: null };
        case 'image':
            return { text: m.image?.caption?.trim() ? `[bild] ${m.image.caption.trim()}` : '[bild]', mediaId: m.image?.id ?? null };
        case 'audio':
            return { text: m.audio?.voice ? '[röstmeddelande]' : '[ljud]', mediaId: m.audio?.id ?? null };
        case 'video':
            return { text: m.video?.caption?.trim() ? `[video] ${m.video.caption.trim()}` : '[video]', mediaId: m.video?.id ?? null };
        case 'document':
            return { text: `[dokument${m.document?.filename ? `: ${m.document.filename}` : ''}]`, mediaId: m.document?.id ?? null };
        case 'sticker':
            return { text: '[sticker]', mediaId: m.sticker?.id ?? null };
        case 'location': {
            const l = m.location;
            const label = [l?.name, l?.address].filter(Boolean).join(', ');
            return { text: `[plats] ${label || `${l?.latitude},${l?.longitude}`}`, mediaId: null };
        }
        case 'contacts':
            return { text: '[kontaktkort]', mediaId: null };
        case 'button':
            return { text: m.button?.text?.trim() || '[knapp]', mediaId: null };
        case 'interactive': {
            const t = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
            return { text: t?.trim() || '[interaktivt svar]', mediaId: null };
        }
        case 'reaction':
            return { text: `[reaktion] ${m.reaction?.emoji ?? ''}`.trim(), mediaId: null };
        case 'unsupported':
            return { text: '[meddelandetyp som WhatsApp inte levererar via API]', mediaId: null };
        default:
            return { text: `[${m.type}]`, mediaId: null };
    }
}

/** Plocka isär Metas kuvert till en platt lista händelser. Okända fält ignoreras. */
export function parseWebhook(body: WaWebhookBody | null | undefined): WaEvent[] {
    const out: WaEvent[] = [];
    if (!body || body.object !== 'whatsapp_business_account') return out;
    for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
            if (change.field && change.field !== 'messages') continue;
            const v = change.value;
            if (!v || v.messaging_product !== 'whatsapp') continue;
            const phoneNumberId = v.metadata?.phone_number_id ?? '';
            const names = new Map<string, string>();
            for (const c of v.contacts ?? []) {
                if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
            }
            for (const m of v.messages ?? []) {
                if (!m.from || !m.id) continue;
                const { text, mediaId } = describeMessage(m);
                out.push({
                    kind: 'message',
                    phoneNumberId,
                    waId: m.from,
                    profileName: names.get(m.from) ?? null,
                    mid: m.id,
                    at: isoFromUnix(m.timestamp),
                    type: m.type,
                    text,
                    mediaId,
                    referral: m.referral ?? null,
                    replyToMid: m.context?.id ?? null,
                });
            }
            for (const s of v.statuses ?? []) {
                if (!s.id || !s.status) continue;
                const err = s.errors?.[0];
                out.push({
                    kind: 'status',
                    phoneNumberId,
                    mid: s.id,
                    status: s.status,
                    at: isoFromUnix(s.timestamp),
                    recipientWaId: s.recipient_id ?? null,
                    conversationOrigin: s.conversation?.origin?.type ?? null,
                    error: err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim() || null : null,
                });
            }
        }
    }
    return out;
}

/** wa_id är E.164 utan plus. Kortets telefon lagras med plus. Båda ska matcha. */
export function normalizeWaId(v: string | null | undefined): string {
    return (v ?? '').replace(/\D/g, '');
}

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 24-timmarsfönstret: öppet om kundens senaste inkommande är yngre än 24 h. */
export function serviceWindowOpen(lastInboundAt: string | Date | null | undefined, now: Date = new Date()): boolean {
    if (!lastInboundAt) return false;
    const t = typeof lastInboundAt === 'string' ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
    return Number.isFinite(t) && now.getTime() - t < SERVICE_WINDOW_MS;
}

/** Metas statusar → vår messages.status. 'read' är ingen egen status hos oss. */
export function mapStatus(s: string): 'sent' | 'delivered' | 'failed' | null {
    if (s === 'sent') return 'sent';
    if (s === 'delivered' || s === 'read') return 'delivered';
    if (s === 'failed') return 'failed';
    return null;
}

// ---------------------------------------------------------------------------
// Databas & nät
// ---------------------------------------------------------------------------

export interface TenantRow { id: string; slug: string; config: Record<string, unknown> | null }

/**
 * Vilken tenant tog emot meddelandet? I första hand det företagsnummer det kom
 * in på (tenants.config.whatsapp_phone_number_id), annars WHATSAPP_TENANT_SLUG.
 * Flera tenanter på samma webhook behöver bara sätta sitt phone_number_id.
 */
export async function resolveTenant(phoneNumberId: string): Promise<TenantRow | null> {
    if (phoneNumberId) {
        const { data } = await supabase
            .from('tenants').select('id, slug, config')
            .filter('config->>whatsapp_phone_number_id', 'eq', phoneNumberId)
            .eq('status', 'active')
            .limit(1);
        if (data && data.length > 0) return data[0] as TenantRow;
    }
    const { data } = await supabase
        .from('tenants').select('id, slug, config')
        .eq('slug', config.WHATSAPP_TENANT_SLUG)
        .limit(1);
    return (data?.[0] as TenantRow | undefined) ?? null;
}

/** Tidpunkten för kundens senaste inkommande WhatsApp-meddelande. */
export async function lastInboundAt(contactId: string): Promise<string | null> {
    const { data } = await supabase
        .from('messages').select('created_at')
        .eq('channel', 'whatsapp').eq('direction', 'inbound')
        .filter('metadata->>contact_id', 'eq', contactId)
        .order('created_at', { ascending: false })
        .limit(1);
    return (data?.[0]?.created_at as string | undefined) ?? null;
}

export type SendResult =
    | { ok: true; mid: string }
    | { ok: false; error: string; code?: 'window_closed' | 'disabled' | 'not_configured' | 'api' };

/**
 * Skicka fritext till ett nummer. Vägrar utanför 24-timmarsfönstret — Meta
 * hade avvisat det ändå, men då med ett fel som ser ut som ett nätfel.
 * Loggar i tråden med provider_message_id så statusarna hittar tillbaka.
 */
export async function sendText(params: {
    contactId: string; waId: string; text: string; tenantId?: string | null; loggedBy?: string;
}): Promise<SendResult> {
    if (!config.WHATSAPP_OUTBOUND_ENABLED) return { ok: false, error: 'WHATSAPP_OUTBOUND_ENABLED=false', code: 'disabled' };
    if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
        return { ok: false, error: 'WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID saknas', code: 'not_configured' };
    }
    const to = normalizeWaId(params.waId);
    if (!to) return { ok: false, error: 'ogiltigt nummer', code: 'api' };

    const last = await lastInboundAt(params.contactId);
    if (!serviceWindowOpen(last)) {
        return { ok: false, code: 'window_closed',
                 error: `24-timmarsfönstret är stängt (senaste inkommande ${last ?? 'saknas'}). Fritext går inte; använd en godkänd mall.` };
    }

    const url = `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    let mid = '';
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to,
                                   type: 'text', text: { preview_url: false, body: params.text } }),
        });
        const j = await r.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } };
        if (!r.ok || !j.messages?.[0]?.id) {
            const msg = j.error ? `${j.error.code ?? r.status} ${j.error.message ?? ''}`.trim() : `HTTP ${r.status}`;
            logger.error('whatsapp', `send misslyckades: ${msg}`);
            return { ok: false, error: msg, code: 'api' };
        }
        mid = j.messages[0].id!;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('whatsapp', `send undantag: ${msg}`);
        return { ok: false, error: msg, code: 'api' };
    }

    await supabase.from('messages').insert({
        customer_id: null,
        role: 'assistant', channel: 'whatsapp', direction: 'outbound', status: 'sent',
        content: params.text,
        provider_message_id: mid,
        metadata: {
            contact_id: params.contactId, tenant_id: params.tenantId ?? null,
            to, mid, logged_by: params.loggedBy ?? 'whatsapp-send',
        },
    });
    return { ok: true, mid };
}
