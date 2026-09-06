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


// ---------------------------------------------------------------------------
// SCC-36: outreach-tratt per dimension (ort, doktrin, textvariant, poäng …)
// ---------------------------------------------------------------------------

export interface FunnelRow {
    enrollment_id: string;
    sequence_name: string | null;
    contact_name: string | null;
    customer_id: string | null;
    area: string | null;
    dm_vertical: string | null;
    dm_variant: string | null;
    score: number | null;
    research_cost_usd: number | null;
    enrolled_at: string;
    enrollment_status: string;
    exit_reason: string | null;
    sent_count: number;
    reply_count: number;
    reply_intent: string | null;
    booking_count: number;
    opportunity_status: string | null;
    stage_name: string | null;
    value_sek: number | null;
}

export const FUNNEL_GROUP_BY = ['area', 'dm_vertical', 'dm_variant', 'sequence_name', 'score_band', 'none'] as const;
export type FunnelGroupBy = typeof FUNNEL_GROUP_BY[number];

export interface FunnelAggregate {
    key: string;
    enrolled: number;
    sent: number;          // enrollments med minst ett skickat mejl
    messages_sent: number; // totalt antal skickade mejl
    replied: number;       // enrollments med minst ett inkommande svar
    interested: number;    // senaste klassning = interested
    booked: number;        // enrollments med minst en icke-avbokad bokning
    won: number;           // opportunity status = won
    value_sek: number;
    cost_usd: number;
    reply_rate: number | null;      // replied / sent
    interested_rate: number | null; // interested / sent
    booking_rate: number | null;    // booked / sent
    cost_per_booking_usd: number | null;
}

/** Poängband så "score" går att gruppera utan att bli 60 grupper. */
export function scoreBand(score: number | null): string {
    if (score === null || Number.isNaN(score)) return '(okänd)';
    if (score >= 80) return '80+';
    if (score >= 60) return '60–79';
    if (score >= 40) return '40–59';
    return '<40';
}

/** Ren aggregering — testbar utan DB. */
export function aggregateFunnel(rows: FunnelRow[], groupBy: FunnelGroupBy): FunnelAggregate[] {
    const keyOf = (r: FunnelRow): string => {
        if (groupBy === 'none') return 'alla';
        if (groupBy === 'score_band') return scoreBand(r.score);
        const v = r[groupBy];
        return v == null || v === '' ? '(okänd)' : String(v);
    };
    const acc = new Map<string, FunnelAggregate>();
    for (const r of rows) {
        const key = keyOf(r);
        const a = acc.get(key) ?? {
            key, enrolled: 0, sent: 0, messages_sent: 0, replied: 0, interested: 0, booked: 0, won: 0,
            value_sek: 0, cost_usd: 0, reply_rate: null, interested_rate: null, booking_rate: null, cost_per_booking_usd: null,
        };
        a.enrolled++;
        const sent = Number(r.sent_count) || 0;
        a.messages_sent += sent;
        if (sent > 0) a.sent++;
        if ((Number(r.reply_count) || 0) > 0) a.replied++;
        if (r.reply_intent === 'interested') a.interested++;
        if ((Number(r.booking_count) || 0) > 0) a.booked++;
        if (r.opportunity_status === 'won') { a.won++; a.value_sek += Number(r.value_sek) || 0; }
        a.cost_usd += Number(r.research_cost_usd) || 0;
        acc.set(key, a);
    }
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    return [...acc.values()]
        .map(a => ({
            ...a,
            cost_usd: Math.round(a.cost_usd * 100) / 100,
            reply_rate: pct(a.replied, a.sent),
            interested_rate: pct(a.interested, a.sent),
            booking_rate: pct(a.booked, a.sent),
            cost_per_booking_usd: a.booked > 0 ? Math.round((a.cost_usd / a.booked) * 100) / 100 : null,
        }))
        .sort((x, y) => y.enrolled - x.enrolled);
}

export async function fetchFunnelRows(filter: { sequence?: string; since?: string } = {}): Promise<FunnelRow[]> {
    let q = supabase.from('v_outreach_funnel').select('*').order('enrolled_at', { ascending: false }).limit(5000);
    if (filter.sequence) q = q.ilike('sequence_name', `%${filter.sequence}%`);
    if (filter.since) q = q.gte('enrolled_at', filter.since);
    const { data, error } = await q;
    if (error) throw new Error(`v_outreach_funnel: ${error.message}`);
    return (data ?? []) as FunnelRow[];
}

// ---------------------------------------------------------------------------
// SCC-36: stämpla bokningar med senaste utskick ("last touch")
// ---------------------------------------------------------------------------

export const ATTRIBUTION_WINDOW_DAYS = 90;

export interface LastTouch {
    message_id: string;
    enrollment_id: string | null;
    channel: string;
    sent_at: string;
}

/** Senaste utgående, faktiskt skickade meddelande till kontakten inom fönstret före `before`. */
export async function findLastTouch(contactId: string, before: Date = new Date()): Promise<LastTouch | null> {
    const since = new Date(before.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000).toISOString();
    const { data } = await supabase
        .from('messages')
        .select('id, channel, created_at, metadata')
        .eq('direction', 'outbound').eq('status', 'sent')
        .contains('metadata', { contact_id: contactId })
        .gte('created_at', since).lte('created_at', before.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
    const m = (data ?? [])[0] as { id: string; channel: string; created_at: string; metadata: Record<string, unknown> | null } | undefined;
    if (!m) return null;
    const enr = m.metadata?.enrollment_id;
    return { message_id: m.id, enrollment_id: typeof enr === 'string' ? enr : null, channel: m.channel, sent_at: m.created_at };
}

// ---------------------------------------------------------------------------
// SCC-39: provisionsunderlag per kund
// ---------------------------------------------------------------------------

export interface CommissionRow {
    booking_id: string;
    customer_id: string | null;
    contact: string;
    attendee_email: string | null;
    booked_at: string;
    starts_at: string | null;
    status: string;
    attributed: boolean;
    touch_at: string | null;
    touch_channel: string | null;
    sequence: string | null;
    paid_confirmed_at: string | null;
    paid_value_sek: number | null;
    commission_sek: number | null;
}

export async function buildCommissionRows(customerId: string, since?: string): Promise<CommissionRow[]> {
    let q = supabase
        .from('bookings')
        .select('id, customer_id, contact_id, attendee_email, attendee_name, created_at, starts_at, status, attributed_message_id, attributed_enrollment_id, attributed_touch_at, paid_confirmed_at, paid_value_sek, commission_sek')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }).limit(2000);
    if (since) q = q.gte('created_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`bookings: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;

    // Slå upp namn, kanal och sekvens separat — inga inbäddade joins att gissa FK-namn på.
    const ids = (k: string) => [...new Set(rows.map(r => r[k]).filter((v): v is string => typeof v === 'string'))];
    const [contacts, messages, enrollments] = await Promise.all([
        ids('contact_id').length ? supabase.from('contacts').select('id, name').in('id', ids('contact_id')) : Promise.resolve({ data: [] }),
        ids('attributed_message_id').length ? supabase.from('messages').select('id, channel').in('id', ids('attributed_message_id')) : Promise.resolve({ data: [] }),
        ids('attributed_enrollment_id').length ? supabase.from('sequence_enrollments').select('id, sequence:sequences(name)').in('id', ids('attributed_enrollment_id')) : Promise.resolve({ data: [] }),
    ]);
    const nameOf = new Map((contacts.data ?? []).map((c: { id: string; name: string | null }) => [c.id, c.name]));
    const channelOf = new Map((messages.data ?? []).map((m: { id: string; channel: string }) => [m.id, m.channel]));
    const seqOf = new Map((enrollments.data ?? []).map((e: { id: string; sequence: { name?: string } | { name?: string }[] | null }) => {
        const seq = Array.isArray(e.sequence) ? e.sequence[0] : e.sequence;
        return [e.id, seq?.name ?? null];
    }));

    return rows.map(b => ({
        booking_id: String(b.id),
        customer_id: (b.customer_id as string | null) ?? null,
        contact: (typeof b.contact_id === 'string' ? nameOf.get(b.contact_id) : null) ?? (b.attendee_name as string | null) ?? '',
        attendee_email: (b.attendee_email as string | null) ?? null,
        booked_at: String(b.created_at),
        starts_at: (b.starts_at as string | null) ?? null,
        status: String(b.status),
        attributed: !!b.attributed_message_id,
        touch_at: (b.attributed_touch_at as string | null) ?? null,
        touch_channel: (typeof b.attributed_message_id === 'string' ? channelOf.get(b.attributed_message_id) : null) ?? null,
        sequence: (typeof b.attributed_enrollment_id === 'string' ? seqOf.get(b.attributed_enrollment_id) : null) ?? null,
        paid_confirmed_at: (b.paid_confirmed_at as string | null) ?? null,
        paid_value_sek: b.paid_value_sek == null ? null : Number(b.paid_value_sek),
        commission_sek: b.commission_sek == null ? null : Number(b.commission_sek),
    }));
}

/** SCC-39: operatören bekräftar att en bokning blev betald/genomförd och sätter provisionen. */
export async function confirmBookingPaid(
    bookingId: string, input: { paid_value_sek?: number | null; commission_sek?: number | null; confirmed: boolean }
): Promise<{ ok: boolean; error?: string }> {
    const patch: Record<string, unknown> = {
        paid_confirmed_at: input.confirmed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
    };
    if (input.paid_value_sek !== undefined) patch.paid_value_sek = input.paid_value_sek;
    if (input.commission_sek !== undefined) patch.commission_sek = input.commission_sek;
    const { data, error } = await supabase.from('bookings').update(patch).eq('id', bookingId).select('id, customer_id, contact_id');
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: 'Bokningen hittades inte' };
    const b = data[0] as { customer_id: string | null; contact_id: string | null };
    await supabase.from('activities').insert({
        customer_id: b.customer_id, agent: 'operator', event_type: 'booking',
        action: input.confirmed ? 'booking.paid_confirmed' : 'booking.paid_unconfirmed', severity: 'info',
        details: { booking_id: bookingId, contact_id: b.contact_id, paid_value_sek: input.paid_value_sek ?? null, commission_sek: input.commission_sek ?? null },
    });
    return { ok: true };
}

/** Operatörens facit på ett svar (t.ex. ett "interested" som i själva verket var ett missförstånd).
 *  Loggas som activity med samma prefix som klassificeraren, så v_outreach_funnel tar senaste. */
export async function overrideReplyIntent(
    contactId: string, intent: 'interested' | 'no' | 'autoreply' | 'question' | 'other', note?: string
): Promise<void> {
    const { data: c } = await supabase.from('contacts').select('customer_id').eq('id', contactId).maybeSingle();
    await supabase.from('activities').insert({
        customer_id: (c as { customer_id?: string | null } | null)?.customer_id ?? null,
        agent: 'operator', event_type: 'message', action: 'reply.classified.manual', severity: 'info',
        details: { contact_id: contactId, intent, confidence: 1, reason: note ?? 'manuellt satt av operatören', by_rule: false, manual: true },
    });
}
