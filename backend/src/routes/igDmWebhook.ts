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

const router = Router();

const payloadSchema = z.object({
    username: z.string().min(1),
    direction: z.enum(['inbound', 'outbound']),
    text: z.string().min(1).max(4000),
    mid: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
});

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
    const { username, direction, text, mid, timestamp } = parsed.data;
    const handle = username.replace(/^@/, '').toLowerCase();

    try {
        // 1. Matcha IG-handle → kontakt (custom.instagram lagras med eller utan @)
        const { data: contacts } = await supabase
            .from('contacts')
            .select('id, name, custom')
            .ilike('custom->>instagram', `%${handle}%`)
            .limit(2);
        const contact = contacts?.[0];
        if (!contact) {
            logger.info('igDm', `DM från okänd IG-handle @${handle} — ingen kontaktmatch, hoppar`);
            return res.json({ matched: false, handle });
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
        }

        logger.info('igDm', `DM ${direction} loggad för ${contact.name} (@${handle})${movedToReplied ? ' + auto-flytt → Replied' : ''}`);
        return res.json({ matched: true, contact: contact.name, movedToReplied });
    } catch (err) {
        logger.error('igDm', `intake-fel: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'internal error' });
    }
});

export default router;
