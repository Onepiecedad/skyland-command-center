/**
 * Attribution (GHL-härledd SCC-36) — knyt hela kedjan lead → kontakt → opportunity
 * → bokning till ETT ställe, samt en exportväg. GHL:s näst vanligaste gap (olöst sen 2019).
 * För dig affärskritiskt: provisionen bygger på att kunna spåra vad en bokning kom ifrån.
 *
 * OBS: betalning/provision är inte i systemet än (SCC-39) — kedjan slutar vid bokning.
 */

import { supabase } from './supabase';

export interface TimelineEvent {
    ts: string;
    kind: 'message' | 'activity' | 'booking';
    channel?: string;
    direction?: string;
    summary: string;
}

/** Full tvärkanals-historik för en kontakt (inget klick-runt). */
export async function getContactTimeline(contactId: string) {
    const [c, msgs, acts, books, opps] = await Promise.all([
        supabase.from('contacts').select('id,name,email,phone,source,status,created_at,tags').eq('id', contactId).maybeSingle(),
        supabase.from('messages').select('created_at,channel,direction,content').contains('metadata', { contact_id: contactId }).order('created_at'),
        supabase.from('activities').select('created_at,action,event_type,severity').contains('details', { contact_id: contactId }).order('created_at'),
        supabase.from('bookings').select('created_at,starts_at,status,title').eq('contact_id', contactId).order('created_at'),
        supabase.from('opportunities').select('created_at,title,value_sek,status,stage:stages(name),pipeline:pipelines(name)').eq('contact_id', contactId),
    ]);
    if (!c.data) return null;

    const events: TimelineEvent[] = [];
    for (const m of (msgs.data ?? []) as Array<Record<string, string>>) {
        events.push({ ts: m.created_at, kind: 'message', channel: m.channel, direction: m.direction, summary: (m.content || '').split('\n')[0].slice(0, 140) });
    }
    for (const a of (acts.data ?? []) as Array<Record<string, string>>) {
        events.push({ ts: a.created_at, kind: 'activity', summary: a.action });
    }
    for (const b of (books.data ?? []) as Array<Record<string, string>>) {
        events.push({ ts: b.created_at, kind: 'booking', summary: `${b.status}: ${b.title ?? ''} ${b.starts_at ?? ''}`.trim() });
    }
    events.sort((x, y) => (x.ts < y.ts ? -1 : 1));

    const M = (msgs.data ?? []) as Array<Record<string, string>>;
    const summary = {
        emails_out: M.filter(m => m.channel === 'email' && m.direction === 'outbound').length,
        emails_in: M.filter(m => m.channel === 'email' && m.direction === 'inbound').length,
        sms_out: M.filter(m => m.channel === 'sms' && m.direction === 'outbound').length,
        bookings: (books.data ?? []).length,
        opportunities: (opps.data ?? []).length,
    };
    return { contact: c.data, opportunities: opps.data ?? [], summary, timeline: events };
}

/** Trattexport (opportunity-centrerad + bokningsstatus) — spårbar källa per deal. */
export async function buildFunnelRows(): Promise<Record<string, unknown>[]> {
    const [{ data: opps }, { data: books }] = await Promise.all([
        supabase.from('opportunities')
            .select('id,title,value_sek,status,created_at,contact:contacts(id,name,email,source),stage:stages(name),pipeline:pipelines(name)')
            .order('created_at', { ascending: false }).limit(1000),
        supabase.from('bookings').select('contact_id,status'),
    ]);

    const bookByContact = new Map<string, { count: number; last: string }>();
    for (const b of (books ?? []) as Array<{ contact_id: string | null; status: string }>) {
        if (!b.contact_id) continue;
        const e = bookByContact.get(b.contact_id) ?? { count: 0, last: '' };
        e.count++; e.last = b.status; bookByContact.set(b.contact_id, e);
    }

    return ((opps ?? []) as Array<Record<string, unknown>>).map(o => {
        const contact = o.contact as { id?: string; name?: string; email?: string; source?: string } | null;
        const bk = contact?.id ? bookByContact.get(contact.id) : undefined;
        return {
            opportunity: o.title,
            pipeline: (o.pipeline as { name?: string } | null)?.name ?? '',
            stage: (o.stage as { name?: string } | null)?.name ?? '',
            value_sek: o.value_sek ?? '',
            status: o.status,
            contact: contact?.name ?? '',
            email: contact?.email ?? '',
            source: contact?.source ?? '',
            created: o.created_at,
            bookings: bk?.count ?? 0,
            last_booking_status: bk?.last ?? '',
        };
    });
}

/** Enkel, robust CSV (citerar fält med komma/citat/radbrytning). */
export function toCsv(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}
