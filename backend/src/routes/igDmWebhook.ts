/**
 * IG-DM-intake (n8n → SCC) — automatisk konversationsloggning.
 *
 * Meta-webhooken (ig-dm-autosvar i n8n) skickar varje DM hit: inkommande
 * meddelanden OCH echoes av operatörens egna skickade svar. SCC matchar
 * IG-handeln mot kontaktkortet, loggar i konversationstråden (dedupe på
 * Metas message-id) och flyttar kortet Contacted → Replied vid första
 * inkommande svaret. Ingen manuell bokföring.
 *
 * Auth: Bearer LEADS_INTAKE_TOKEN (samma som lead-intaket — n8n känner den).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';
import { config } from '../config';
import { logger } from '../services/logger';
import { createAutoTodo } from '../services/todos';

const router = Router();

const payloadSchema = z.object({
    username: z.string().min(1),
    direction: z.enum(['inbound', 'outbound']),
    text: z.string().min(1).max(4000),
    mid: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    // IG:s numeriska konto-id (IGSID). Stabil nyckel som matchar även när
    // handle-texten på kortet är fel — n8n skickar med den när den finns.
    ig_id: z.string().optional(),
});

interface MatchedContact {
    id: string;
    name: string;
    custom: Record<string, unknown> | null;
}

function checkToken(req: Request): boolean {
    const expected = process.env.LEADS_INTAKE_TOKEN || config.SCC_API_TOKEN;
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return !!expected && got === expected;
}

router.post('/', async (req: Request, res: Response) => {
    if (!checkToken(req)) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'validation failed', details: parsed.error.issues });
    }
    const { username, direction, text, mid, timestamp, ig_id } = parsed.data;
    const handle = username.replace(/^@/, '').toLowerCase();

    try {
        // 1. Matcha kontakt. I första hand på IG:s numeriska id (stabilt även om
        //    handle-texten är fel), annars på handeln. Tomt handle utan id matchar
        //    aldrig — annars skulle ilike '%%' råka träffa första bästa kort.
        let contact: MatchedContact | null = null;

        if (ig_id) {
            const { data } = await supabase
                .from('contacts')
                .select('id, name, custom')
                .filter('custom->>ig_id', 'eq', ig_id)
                .limit(1);
            contact = (data?.[0] as MatchedContact | undefined) ?? null;
        }
        if (!contact && handle) {
            const { data } = await supabase
                .from('contacts')
                .select('id, name, custom')
                .ilike('custom->>instagram', `%${handle}%`)
                .limit(2);
            contact = (data?.[0] as MatchedContact | undefined) ?? null;

            // Self-healing: lär in det numeriska id:t på kortet så framtida DM
            // matchar direkt, även om handeln på kortet skulle vara felskriven.
            if (contact && ig_id && !contact.custom?.ig_id) {
                await supabase.from('contacts')
                    .update({ custom: { ...(contact.custom ?? {}), ig_id }, updated_at: new Date().toISOString() })
                    .eq('id', contact.id);
            }
        }

        if (!contact) {
            // Ingen match → logga en SYNLIG orphan istället för att kasta tyst.
            // Då dyker en felaktig handle upp direkt i loggen i stället för att
            // svar försvinner spårlöst. Dedupas på mid mot webhook-omleveranser.
            if (mid) {
                const { data: dupOrphan } = await supabase
                    .from('activities').select('id')
                    .eq('action', 'ig_dm_unmatched')
                    .filter('details->>mid', 'eq', mid)
                    .limit(1);
                if (dupOrphan && dupOrphan.length > 0) {
                    return res.json({ matched: false, handle, orphan: 'deduped' });
                }
            }
            await supabase.from('activities').insert({
                customer_id: null,
                agent: 'ig-webhook',
                action: 'ig_dm_unmatched',
                event_type: 'crm',
                severity: 'warning',
                details: {
                    handle,
                    ig_id: ig_id ?? null,
                    direction,
                    text: text.length > 160 ? `${text.slice(0, 157)}…` : text,
                    ...(mid ? { mid } : {}),
                    hint: 'Ingen kontakt matchar denna IG-handle/id — kontrollera handeln på kortet.',
                },
            });
            logger.info('igDm', `Omatchad DM @${handle}${ig_id ? ` (id ${ig_id})` : ''} — orphan loggad`);
            return res.json({ matched: false, handle, orphan: true });
        }

        // 2. Dedupe på Metas message-id (webhooks kan levereras flera gånger)
        if (mid) {
            const { data: dup } = await supabase
                .from('messages').select('id')
                .filter('metadata->>mid', 'eq', mid)
                .limit(1);
            if (dup && dup.length > 0) {
                return res.json({ matched: true, deduped: true });
            }
        }

        // 2b. Innehålls-dedupe (längre meddelanden): backfill från Graph-API:t
        // får inte dubblera trådar som redan loggats manuellt (utan mid).
        if (text.length > 20) {
            const { data: dupContent } = await supabase
                .from('messages').select('id')
                .eq('channel', 'instagram')
                .eq('content', text)
                .filter('metadata->>contact_id', 'eq', contact.id)
                .limit(1);
            if (dupContent && dupContent.length > 0) {
                return res.json({ matched: true, deduped: true, by: 'content' });
            }
        }

        // 3. Logga i konversationstråden
        const createdAt = timestamp
            ? new Date(typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)).toISOString()
            : new Date().toISOString();
        await supabase.from('messages').insert({
            role: 'user',
            channel: 'instagram',
            direction,
            content: text,
            created_at: createdAt,
            metadata: {
                contact_id: contact.id,
                logged_by: 'ig-webhook',
                interaction: direction === 'inbound' ? 'ig_dm_reply' : 'ig_dm_sent',
                ...(mid ? { mid } : {}),
            },
        });

        // 4. Första inkommande svaret → Contacted blir Replied automatiskt
        let movedToReplied = false;
        if (direction === 'inbound') {
            const { data: opp } = await supabase
                .from('opportunities')
                .select('id, pipeline_id, stage_id, stages!inner(name)')
                .eq('contact_id', contact.id)
                .limit(1)
                .maybeSingle();
            const stageName = (opp as { stages?: { name?: string } } | null)?.stages?.name;
            if (opp && stageName === 'Contacted') {
                const { data: replied } = await supabase
                    .from('stages').select('id')
                    .eq('pipeline_id', opp.pipeline_id).eq('name', 'Replied')
                    .maybeSingle();
                if (replied) {
                    await supabase.from('opportunities').update({ stage_id: replied.id }).eq('id', opp.id);
                    movedToReplied = true;
                    await supabase.from('activities').insert({
                        customer_id: null,
                        agent: 'ig-webhook',
                        action: 'ig_dm_reply_received',
                        event_type: 'crm',
                        severity: 'info',
                        details: { contact_id: contact.id, contact_name: contact.name, auto_moved: 'Contacted→Replied' },
                    });
                }
            }

            // Auto-todo: en öppen "Svara"-punkt per kontakt (dedupas på auto_key).
            const endOfToday = new Date();
            endOfToday.setHours(23, 59, 0, 0);
            await createAutoTodo({
                title: `Svara ${contact.name}`,
                notes: text.length > 120 ? `${text.slice(0, 117)}…` : text,
                dueAt: endOfToday.toISOString(),
                priority: 'high',
                contactId: contact.id,
                opportunityId: (opp as { id?: string } | null)?.id ?? null,
                autoKey: `reply:${contact.id}`,
            });
        }

        logger.info('igDm', `DM ${direction} loggad för ${contact.name} (@${handle})${movedToReplied ? ' + auto-flytt → Replied' : ''}`);
        return res.json({ matched: true, contact: contact.name, movedToReplied });
    } catch (err) {
        logger.error('igDm', `intake-fel: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

export default router;
