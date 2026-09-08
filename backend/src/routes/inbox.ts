/**
 * Inkorgen — läsverktyg för operatören och Alex (8 sep 2026).
 *
 * GET /api/v1/inbox?since=24h&channel=email&kind=svar&limit=50
 *
 * Fram till nu fanns bara /contacts/:id/conversation, alltså tråden för ETT kort.
 * Frågan "vad har kommit in i dag och från vem?" gick inte att ställa via API:t,
 * så Alex gissade när Joakim frågade (8 sep). Den här listan svarar på den.
 *
 * Varje rad sorteras i en av tre sorter, så att Alex kan skilja kundsvar från brus:
 *   svar   — kopplad till ett kort (metadata.contact_id). Det är de som betyder något.
 *   dmarc  — aggregerade DMARC-rapporter (noreply-dmarc-support@google.com m.fl.).
 *            Maskinläsbar XML i zip, inte avsedd för människor. Egen hantering senare.
 *   brus   — allt annat som Inbound råkat fånga (Airbnb, test, nyhetsbrev).
 *
 * Bara läsning. Ändrar aldrig något. Ligger bakom global auth.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

type Kind = 'svar' | 'dmarc' | 'brus';

const DMARC_RE = /dmarc|report domain:/i;

function parseSince(raw: unknown): Date {
    const s = typeof raw === 'string' ? raw.trim() : '';
    const m = /^(\d+)([hd])$/.exec(s);
    if (m) {
        const n = Number(m[1]);
        const ms = m[2] === 'h' ? n * 36e5 : n * 864e5;
        return new Date(Date.now() - ms);
    }
    const d = s ? new Date(s) : null;
    if (d && !Number.isNaN(d.getTime())) return d;
    return new Date(Date.now() - 24 * 36e5);
}

function kindOf(meta: Record<string, unknown>): Kind {
    const from = String(meta.from ?? '');
    const subject = String(meta.subject ?? '');
    if (DMARC_RE.test(from) || DMARC_RE.test(subject)) return 'dmarc';
    if (meta.contact_id) return 'svar';
    return 'brus';
}

router.get('/', async (req: Request, res: Response) => {
    try {
        const since = parseSince(req.query.since);
        const channel = typeof req.query.channel === 'string' ? req.query.channel : null;
        const direction = typeof req.query.direction === 'string' ? req.query.direction : 'inbound';
        const kindFilter = typeof req.query.kind === 'string' ? (req.query.kind as Kind) : null;
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

        let q = supabase
            .from('messages')
            .select('id, direction, channel, status, content, metadata, created_at')
            .gte('created_at', since.toISOString())
            .order('created_at', { ascending: false })
            .limit(limit);
        if (direction !== 'all') q = q.eq('direction', direction);
        if (channel) q = q.eq('channel', channel);

        const { data: rows, error } = await q;
        if (error) return res.status(500).json({ error: error.message });

        const messages = (rows ?? []).map((m) => {
            const meta = (m.metadata ?? {}) as Record<string, unknown>;
            return { ...m, meta, kind: kindOf(meta) };
        }).filter((m) => !kindFilter || m.kind === kindFilter);

        // Kortnamn i ett svep, inte ett anrop per rad.
        const contactIds = [...new Set(messages.map((m) => m.meta.contact_id).filter((v): v is string => typeof v === 'string'))];
        const names = new Map<string, { name: string | null; status: string | null }>();
        if (contactIds.length) {
            const { data: contacts } = await supabase.from('contacts').select('id, name, status').in('id', contactIds);
            for (const c of contacts ?? []) names.set(c.id, { name: c.name ?? null, status: c.status ?? null });
        }

        // Senaste klassning per kort ur activities (replyClassifier loggar dit, inte på raden).
        const klass = new Map<string, { intent: string; confidence: number; acted: boolean }>();
        if (contactIds.length) {
            const { data: acts } = await supabase
                .from('activities')
                .select('action, details, created_at')
                .in('action', ['reply.classified', 'reply.classified.low_confidence', 'reply.classified.manual'])
                .gte('created_at', since.toISOString())
                .order('created_at', { ascending: false })
                .limit(500);
            for (const a of acts ?? []) {
                const d = (a.details ?? {}) as Record<string, unknown>;
                const cid = typeof d.contact_id === 'string' ? d.contact_id : null;
                if (!cid || klass.has(cid) || !contactIds.includes(cid)) continue;
                klass.set(cid, {
                    intent: String(d.intent ?? '?'),
                    confidence: Number(d.confidence ?? 0),
                    acted: a.action !== 'reply.classified.low_confidence',
                });
            }
        }

        const out = messages.map((m) => {
            const cid = typeof m.meta.contact_id === 'string' ? m.meta.contact_id : null;
            const text = (m.content ?? '').replace(/\s+/g, ' ').trim();
            return {
                id: m.id,
                created_at: m.created_at,
                direction: m.direction,
                channel: m.channel,
                status: m.status,
                kind: m.kind,
                from: (m.meta.from as string | undefined) ?? null,
                to: (m.meta.to as string | undefined) ?? null,
                subject: (m.meta.subject as string | undefined) ?? null,
                snippet: text.slice(0, 240),
                contact_id: cid,
                contact_name: cid ? names.get(cid)?.name ?? null : null,
                contact_status: cid ? names.get(cid)?.status ?? null : null,
                classification: cid ? klass.get(cid) ?? null : null,
            };
        });

        const counts = out.reduce<Record<Kind, number>>((acc, m) => { acc[m.kind]++; return acc; }, { svar: 0, dmarc: 0, brus: 0 });
        return res.json({ since: since.toISOString(), count: out.length, counts, messages: out });
    } catch (err) {
        console.error('[Inbox] error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
