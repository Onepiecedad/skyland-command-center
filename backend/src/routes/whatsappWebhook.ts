/**
 * WhatsApp Cloud API-webhook (Meta → SCC). Cold Experience-intaget.
 *
 * GET  /   Metas verifiering vid prenumeration: hub.verify_token måste vara
 *          WHATSAPP_VERIFY_TOKEN, svaret är hub.challenge som ren text.
 * POST /   Inkommande meddelanden och leveransstatusar.
 *
 * Varje inkommande meddelande blir: kontakt (på wa_id, skapas om den saknas,
 * i rätt tenant), ett öppet kort i tenantens pipeline om det inte redan finns
 * ett, och en rad i tråden. Annonsattributionen (CTWA-referral) sparas vid
 * första beröringen och skrivs aldrig över — det är den provisionsfakturan
 * vilar på. Statusar uppdaterar våra utgående på provider_message_id.
 *
 * Auth: signatur med WHATSAPP_APP_SECRET. Saknas hemligheten accepteras bara
 * Bearer LEADS_INTAKE_TOKEN (fallback SCC_API_TOKEN) — samma test/manuella
 * väg som IG-DM-webhooken. Monteras FÖRE global auth.
 *
 * Meta kräver 200 snabbt och levererar om vid allt annat; därför svarar vi 200
 * även när en enskild händelse går sönder, och loggar felet synligt.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';
import { createAutoTodo } from '../services/todos';
import {
    parseWebhook, verifySignature, normalizeWaId, mapStatus, resolveTenant,
    type InboundEvent, type StatusEvent, type TenantRow, type WaWebhookBody,
} from '../services/whatsapp';

const router = Router();

function bearerOk(req: Request): boolean {
    const expected = process.env.LEADS_INTAKE_TOKEN || config.SCC_API_TOKEN;
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return !!expected && got === expected;
}

// GET / — Metas prenumerationsverifiering
router.get('/', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && token === config.WHATSAPP_VERIFY_TOKEN && typeof challenge === 'string') {
        return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).json({ error: 'verify_token matchar inte' });
});

// POST / — händelser
router.post('/', async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const sig = req.header('x-hub-signature-256');
    if (config.WHATSAPP_APP_SECRET) {
        if (!verifySignature(raw, sig, config.WHATSAPP_APP_SECRET)) {
            logger.warn('whatsapp', 'POST med ogiltig eller saknad X-Hub-Signature-256 avvisad');
            return res.status(401).json({ error: 'ogiltig signatur' });
        }
    } else if (!bearerOk(req)) {
        return res.status(401).json({ error: 'WHATSAPP_APP_SECRET saknas och Bearer-token matchar inte' });
    }

    const events = parseWebhook(req.body as WaWebhookBody);
    if (events.length === 0) {
        return res.status(200).json({ status: 'ignored' });
    }

    let messages = 0, statuses = 0, failed = 0;
    for (const ev of events) {
        try {
            if (ev.kind === 'message') { await handleInbound(ev); messages++; }
            else { await handleStatus(ev); statuses++; }
        } catch (err) {
            failed++;
            logger.error('whatsapp', `händelse ${ev.kind} ${ev.mid} misslyckades: ${err instanceof Error ? err.message : err}`);
        }
    }
    return res.status(200).json({ status: 'ok', messages, statuses, failed });
});

// ---------------------------------------------------------------------------

interface ContactRow { id: string; name: string; phone: string | null; custom: Record<string, unknown> | null; tenant_id: string }

async function findContact(tenant: TenantRow, waId: string): Promise<ContactRow | null> {
    const { data: byWa } = await supabase
        .from('contacts').select('id, name, phone, custom, tenant_id')
        .eq('tenant_id', tenant.id)
        .filter('custom->>wa_id', 'eq', waId)
        .limit(1);
    if (byWa && byWa.length > 0) return byWa[0] as ContactRow;

    // Kortets telefon lagras med plus och ibland mellanslag; wa_id är bara siffror.
    const { data: byPhone } = await supabase
        .from('contacts').select('id, name, phone, custom, tenant_id')
        .eq('tenant_id', tenant.id)
        .not('phone', 'is', null)
        .limit(500);
    const hit = (byPhone ?? []).find(c => normalizeWaId(c.phone as string) === waId);
    if (hit) {
        // Lär in wa_id på kortet så nästa matchning är direkt.
        await supabase.from('contacts')
            .update({ custom: { ...((hit.custom as Record<string, unknown>) ?? {}), wa_id: waId }, updated_at: new Date().toISOString() })
            .eq('id', hit.id);
        return hit as ContactRow;
    }
    return null;
}

async function createContact(tenant: TenantRow, ev: InboundEvent): Promise<ContactRow> {
    const name = ev.profileName?.trim() || `+${ev.waId}`;
    const custom: Record<string, unknown> = {
        wa_id: ev.waId,
        whatsapp_name: ev.profileName ?? null,
        whatsapp_phone_number_id: ev.phoneNumberId || null,
        first_contact_at: ev.at,
    };
    if (ev.referral) custom.ad_referral = { ...ev.referral, captured_at: ev.at };
    const { data, error } = await supabase.from('contacts').insert({
        tenant_id: tenant.id,
        name, phone: `+${ev.waId}`,
        source: ev.referral ? 'whatsapp_ctwa' : 'whatsapp',
        status: 'new',
        tags: ['whatsapp', 'lead', ...(ev.referral ? ['ctwa'] : [])],
        dedupe_key: `wa:${tenant.slug}:${ev.waId}`,
        custom,
    }).select('id, name, phone, custom, tenant_id').single();
    if (error || !data) throw new Error(`kunde inte skapa kontakt: ${error?.message ?? 'okänt'}`);

    await supabase.from('activities').insert({
        customer_id: null,
        agent: 'whatsapp-webhook',
        action: 'whatsapp_lead_received',
        event_type: 'crm',
        severity: 'info',
        details: { contact_id: data.id, name, wa_id: ev.waId, tenant: tenant.slug,
                   source: ev.referral ? 'ctwa' : 'direct', ad_id: ev.referral?.source_id ?? null },
    });
    return data as ContactRow;
}

/** Kortet i tenantens pipeline: det öppna om det finns, annars ett nytt i första stadiet. */
async function ensureOpportunity(tenant: TenantRow, contact: ContactRow): Promise<string | null> {
    const { data: open } = await supabase
        .from('opportunities').select('id')
        .eq('contact_id', contact.id).eq('tenant_id', tenant.id).eq('status', 'open')
        .limit(1);
    if (open && open.length > 0) return open[0].id as string;

    const preferred = typeof tenant.config?.whatsapp_pipeline === 'string' ? tenant.config.whatsapp_pipeline : null;
    let q = supabase.from('pipelines').select('id, name').eq('tenant_id', tenant.id);
    q = preferred ? q.eq('name', preferred) : q.order('created_at', { ascending: true });
    const { data: pipes } = await q.limit(1);
    const pipe = pipes?.[0];
    if (!pipe) {
        logger.warn('whatsapp', `tenant ${tenant.slug} saknar pipeline — kontakten finns men inget kort skapades`);
        return null;
    }
    const { data: stage } = await supabase
        .from('stages').select('id').eq('pipeline_id', pipe.id)
        .order('position', { ascending: true }).limit(1).maybeSingle();
    if (!stage) return null;

    const { data: opp, error } = await supabase.from('opportunities').insert({
        tenant_id: tenant.id, contact_id: contact.id, pipeline_id: pipe.id, stage_id: stage.id,
        title: contact.name, status: 'open',
    }).select('id').single();
    if (error) throw new Error(`kunde inte skapa kort: ${error.message}`);
    return opp?.id ?? null;
}

async function handleInbound(ev: InboundEvent): Promise<void> {
    const tenant = await resolveTenant(ev.phoneNumberId);
    if (!tenant) {
        logger.error('whatsapp', `ingen tenant för phone_number_id ${ev.phoneNumberId || '(saknas)'} och WHATSAPP_TENANT_SLUG=${config.WHATSAPP_TENANT_SLUG} finns inte`);
        throw new Error('tenant saknas');
    }

    // Dedupe på Metas meddelande-id — webhooken levereras om vid minsta tvekan.
    const { data: dup } = await supabase
        .from('messages').select('id').filter('metadata->>mid', 'eq', ev.mid).limit(1);
    if (dup && dup.length > 0) return;

    let contact = await findContact(tenant, ev.waId);
    const isNew = !contact;
    if (!contact) contact = await createContact(tenant, ev);
    else if (ev.referral && !(contact.custom ?? {}).ad_referral) {
        // Befintlig kontakt som nu kommer via en annons: första referralen sparas, aldrig senare.
        await supabase.from('contacts')
            .update({ custom: { ...(contact.custom ?? {}), ad_referral: { ...ev.referral, captured_at: ev.at } },
                      updated_at: new Date().toISOString() })
            .eq('id', contact.id);
    }

    const oppId = await ensureOpportunity(tenant, contact);

    await supabase.from('messages').insert({
        customer_id: null,
        role: 'user', channel: 'whatsapp', direction: 'inbound',
        content: ev.text,
        created_at: ev.at,
        provider_message_id: ev.mid,
        metadata: {
            contact_id: contact.id, opportunity_id: oppId, tenant_id: tenant.id,
            wa_id: ev.waId, mid: ev.mid, type: ev.type,
            media_id: ev.mediaId, reply_to_mid: ev.replyToMid,
            phone_number_id: ev.phoneNumberId || null,
            referral: ev.referral, logged_by: 'whatsapp-webhook',
        },
    });

    const endOfToday = new Date(); endOfToday.setHours(23, 59, 0, 0);
    await createAutoTodo({
        title: `Svara ${contact.name} (WhatsApp)`,
        notes: ev.text.length > 120 ? `${ev.text.slice(0, 117)}…` : ev.text,
        dueAt: endOfToday.toISOString(),
        priority: 'high',
        contactId: contact.id,
        opportunityId: oppId,
        autoKey: `reply:${contact.id}`,
    });

    logger.info('whatsapp', `${isNew ? 'NY lead' : 'meddelande'} ${contact.name} (${tenant.slug})${ev.referral ? ' via annons ' + (ev.referral.source_id ?? '') : ''}`);
}

async function handleStatus(ev: StatusEvent): Promise<void> {
    const status = mapStatus(ev.status);
    const { data: rows } = await supabase
        .from('messages').select('id, metadata, status')
        .eq('provider_message_id', ev.mid).limit(1);
    const row = rows?.[0];
    if (!row) return; // status för något vi inte skickat (eller mall via annan väg) — inget att uppdatera

    const meta = { ...((row.metadata as Record<string, unknown>) ?? {}) };
    meta[`${ev.status}_at`] = ev.at;
    if (ev.conversationOrigin) meta.conversation_origin = ev.conversationOrigin;
    if (ev.error) meta.error = ev.error;

    const patch: Record<string, unknown> = { metadata: meta };
    // Gå aldrig bakåt: en sen 'sent' efter 'delivered' ska inte nedgradera.
    const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, failed: 3 };
    if (status && (rank[status] ?? 0) >= (rank[String(row.status)] ?? 0)) patch.status = status;
    await supabase.from('messages').update(patch).eq('id', row.id);
}

export default router;
