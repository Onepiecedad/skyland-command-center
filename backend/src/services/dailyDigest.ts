/**
 * Daglig digest (plan 3.2)
 *
 * Ett mejl varje morgon med gårdagens siffror. Poller-vakten (3.3) mejlar när
 * något är sönder; den här svarar på den andra frågan: vad gjorde maskinen
 * medan jag sov, när allt fungerade?
 *
 * Tre val som styr designen:
 *
 * 1. **Siffrorna hämtas, de räknas inte fram i huvudet.** Varje rad i digesten
 *    går att spåra till en fråga mot en tabell. Står det noll utskick är det för
 *    att det finns noll rader, inte för att en räknare glömdes bort.
 *
 * 2. **En tom dag mejlas ändå.** Tystnad går inte att skilja från "systemet är
 *    dött". Ett mejl som säger noll är information; inget mejl är oro.
 *
 * 3. **Dubbelutskick förhindras i databasen, inte i minnet.** Render startar om
 *    containern när den vill. En omstart klockan 07:20 skulle skicka digesten en
 *    gång till om spärren bara låg i minnet, så vi frågar activities om dagens
 *    digest redan gått.
 */
import { supabase } from './supabase';
import { config } from '../config';
import { getEmailProvider } from './email';
import { checkAll } from './integrationHealth';
import { pollerStatus } from './pollerWatchdog';
import { logger } from './logger';

export interface DigestData {
    from: string;
    to: string;
    sent: { email: number; sms: number; failed: number };
    shadow: { created: number; pendingTotal: number; judged: number; verdicts: Record<string, number> };
    replies: {
        inbound: number;
        acted: number;
        lowConfidence: number;
        byIntent: Record<string, number>;
        moved: number;
        suppressed: number;
    };
    newContacts: number;
    /** Bokningar som ligger framåt i tiden, närmast först. Kvällssammanfattningen läser dem. */
    upcoming: { when: string; title: string; who: string }[];
    poller: { stale: boolean; secondsSince: number | null; lastWorker: string | null };
    health: { down: string[]; checked: number };
    cost: { usd: number; calls: number };
}

const STOCKHOLM = 'Europe/Stockholm';

/** Klockslag och datum i svensk tid, oavsett vad containern tror att den står i. */
export function stockholmParts(now: Date): { hour: number; date: string } {
    const fmt = new Intl.DateTimeFormat('sv-SE', {
        timeZone: STOCKHOLM, hour: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
    return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

function count<T>(rows: T[], pred: (r: T) => boolean): number {
    return rows.reduce((n, r) => (pred(r) ? n + 1 : n), 0);
}

/**
 * Samlar dygnets siffror. Varje delfråga är omsluten var för sig: en tabell som
 * strular ska ge en lucka i digesten, inte ett uteblivet mejl.
 */
export async function collectDigest(now: Date = new Date(), windowMs = 86_400_000): Promise<DigestData> {
    const end = now.toISOString();
    const start = new Date(now.getTime() - windowMs).toISOString();

    const d: DigestData = {
        from: start, to: end,
        sent: { email: 0, sms: 0, failed: 0 },
        shadow: { created: 0, pendingTotal: 0, judged: 0, verdicts: {} },
        replies: { inbound: 0, acted: 0, lowConfidence: 0, byIntent: {}, moved: 0, suppressed: 0 },
        newContacts: 0,
        upcoming: [],
        poller: { stale: false, secondsSince: null, lastWorker: null },
        health: { down: [], checked: 0 },
        cost: { usd: 0, calls: 0 },
    };

    try {
        const { data } = await supabase
            .from('messages')
            .select('channel, direction, status, metadata, created_at')
            .gte('created_at', start).lte('created_at', end);
        const rows = data ?? [];
        const out = rows.filter(r => r.direction === 'outbound');
        d.sent.email = count(out, r => r.channel === 'email' && (r.status === 'sent' || r.status === 'delivered'));
        d.sent.sms = count(out, r => r.channel === 'sms' && (r.status === 'sent' || r.status === 'delivered'));
        d.sent.failed = count(out, r => r.status === 'failed' || r.status === 'bounced');
        d.shadow.created = count(out, r => r.status === 'shadow');
        d.replies.inbound = count(rows, r => r.direction === 'inbound');
    } catch (err) {
        logger.warn('dailyDigest', `meddelanden: ${err instanceof Error ? err.message : err}`);
    }

    // Skuggrader som väntar på dom är inte en dygnssiffra — kön är kön oavsett
    // när raden skapades, och det är kölängden Joakim behöver se på morgonen.
    try {
        const { data } = await supabase
            .from('messages')
            .select('metadata')
            .eq('status', 'shadow')
            .limit(2000);
        for (const row of data ?? []) {
            const review = (row.metadata as Record<string, unknown> | null)?.review as
                { verdict?: string; at?: string } | null | undefined;
            if (!review?.verdict) { d.shadow.pendingTotal++; continue; }
            if (review.at && review.at >= start) {
                d.shadow.judged++;
                d.shadow.verdicts[review.verdict] = (d.shadow.verdicts[review.verdict] ?? 0) + 1;
            }
        }
    } catch (err) {
        logger.warn('dailyDigest', `skuggkö: ${err instanceof Error ? err.message : err}`);
    }

    try {
        const { data } = await supabase
            .from('activities')
            .select('action, details, created_at')
            .in('action', ['reply.classified', 'reply.classified.low_confidence'])
            .gte('created_at', start).lte('created_at', end);
        for (const a of data ?? []) {
            const det = (a.details ?? {}) as Record<string, unknown>;
            const intent = typeof det.intent === 'string' ? det.intent : 'okänd';
            d.replies.byIntent[intent] = (d.replies.byIntent[intent] ?? 0) + 1;
            if (a.action === 'reply.classified.low_confidence') d.replies.lowConfidence++;
            else d.replies.acted++;
            if (det.moved === true) d.replies.moved++;
            if (det.suppressed === true) d.replies.suppressed++;
        }
    } catch (err) {
        logger.warn('dailyDigest', `svarsklasser: ${err instanceof Error ? err.message : err}`);
    }

    try {
        const { count: n } = await supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', start).lte('created_at', end);
        d.newContacts = n ?? 0;
    } catch (err) {
        logger.warn('dailyDigest', `nya kontakter: ${err instanceof Error ? err.message : err}`);
    }

    try {
        const { data } = await supabase
            .from('bookings')
            .select('title, attendee_name, attendee_email, starts_at, status')
            .eq('status', 'booked')
            .gte('starts_at', end)
            .lte('starts_at', new Date(now.getTime() + 7 * 86_400_000).toISOString())
            .order('starts_at', { ascending: true })
            .limit(10);
        d.upcoming = (data ?? []).map(b => ({
            when: String(b.starts_at ?? ''),
            title: String(b.title ?? 'Möte'),
            who: String(b.attendee_name || b.attendee_email || ''),
        }));
    } catch (err) {
        logger.warn('dailyDigest', `bokningar: ${err instanceof Error ? err.message : err}`);
    }

    try {
        const { data } = await supabase
            .from('costs')
            .select('cost_usd, call_count, created_at')
            .gte('created_at', start).lte('created_at', end);
        for (const c of data ?? []) {
            d.cost.usd += Number(c.cost_usd ?? 0);
            d.cost.calls += Number(c.call_count ?? 0);
        }
    } catch (err) {
        logger.warn('dailyDigest', `kostnad: ${err instanceof Error ? err.message : err}`);
    }

    try {
        const p = pollerStatus(now.getTime());
        d.poller = { stale: p.stale, secondsSince: p.secondsSince, lastWorker: p.lastWorker };
    } catch { /* vakten är inte igång — lämna default */ }

    try {
        const health = await checkAll();
        d.health.checked = health.length;
        d.health.down = health.filter(h => h.status !== 'up' && h.status !== 'not_configured').map(h => `${h.name} (${h.status})`);
    } catch (err) {
        logger.warn('dailyDigest', `integrationer: ${err instanceof Error ? err.message : err}`);
    }

    return d;
}

function sv(dt: string): string {
    return new Date(dt).toLocaleString('sv-SE', { timeZone: STOCKHOLM, dateStyle: 'short', timeStyle: 'short' });
}

/** Ren funktion — testas utan nätverk. */
export function renderDigest(d: DigestData): { subject: string; text: string } {
    const intents = Object.entries(d.replies.byIntent).sort((a, b) => b[1] - a[1]);
    const verdicts = Object.entries(d.shadow.verdicts).sort((a, b) => b[1] - a[1]);
    const problem = d.poller.stale || d.health.down.length > 0 || d.sent.failed > 0;

    const lines = [
        `Dygnet ${sv(d.from)} – ${sv(d.to)}`,
        '',
        'UT',
        `  Mejl skickade: ${d.sent.email}`,
        `  SMS skickade: ${d.sent.sms}`,
        `  Misslyckade/studsade: ${d.sent.failed}`,
        `  Skuggrader loggade: ${d.shadow.created}`,
        '',
        'SKUGGVECKA',
        `  Väntar på din dom: ${d.shadow.pendingTotal}`,
        `  Dömda i dygnet: ${d.shadow.judged}${verdicts.length ? ` (${verdicts.map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`,
        '',
        'IN',
        `  Svar inkomna: ${d.replies.inbound}`,
        `  Klassade och agerade: ${d.replies.acted}`,
        `  Under tröskeln (loggade, inget hände): ${d.replies.lowConfidence}`,
        intents.length ? `  Fördelning: ${intents.map(([k, n]) => `${k} ${n}`).join(', ')}` : '  Fördelning: —',
        `  Kort flyttade: ${d.replies.moved}   Spärrade adresser: ${d.replies.suppressed}`,
        '',
        'PIPELINE',
        `  Nya kontakter: ${d.newContacts}`,
        d.upcoming.length
            ? `  Kommande möten: ${d.upcoming.slice(0, 5).map(b => `${sv(b.when)} ${b.who || b.title}`).join(' · ')}`
            : '  Kommande möten: inga bokade',
        '',
        'DRIFT',
        `  Poller: ${d.poller.stale ? 'TYST — kolla VPS:en' : 'hämtar'}` +
            `${d.poller.secondsSince === null ? '' : ` (senast ${d.poller.secondsSince}s sedan)`}` +
            `${d.poller.lastWorker ? `, ${d.poller.lastWorker}` : ''}`,
        `  Integrationer: ${d.health.down.length ? `NERE — ${d.health.down.join(', ')}` : `${d.health.checked} kontrollerade, alla uppe`}`,
        `  LLM-kostnad: $${d.cost.usd.toFixed(2)} på ${d.cost.calls} anrop`,
    ];

    const head = problem ? '⚠ ' : '';
    const subject = `${head}Skyland dygnet: ${d.sent.email} mejl, ${d.replies.inbound} svar, ${d.shadow.pendingTotal} väntar på dom`;
    return { subject, text: lines.join('\n') };
}

/** Har dagens digest redan gått? Spärren ligger i databasen, inte i minnet. */
export async function alreadySentToday(now: Date = new Date()): Promise<boolean> {
    const today = stockholmParts(now).date;
    try {
        const { data } = await supabase
            .from('activities')
            .select('details')
            .eq('action', 'digest.sent')
            .gte('created_at', new Date(now.getTime() - 36 * 3600_000).toISOString())
            .limit(50);
        return (data ?? []).some(a => (a.details as Record<string, unknown> | null)?.date === today);
    } catch (err) {
        // Osäker? Skicka hellre en digest för mycket än att tappa den helt.
        logger.warn('dailyDigest', `kunde inte läsa spärren: ${err instanceof Error ? err.message : err}`);
        return false;
    }
}

/** Bygger och skickar. Exporterad så den går att trigga manuellt. */
export async function sendDailyDigest(now: Date = new Date()): Promise<'sent' | 'no_recipient' | 'failed'> {
    if (!config.EMAIL_FORWARD_TO) {
        logger.warn('dailyDigest', 'EMAIL_FORWARD_TO saknas — digesten byggs inte');
        return 'no_recipient';
    }
    const data = await collectDigest(now);
    const { subject, text } = renderDigest(data);
    try {
        await getEmailProvider().send({ to: config.EMAIL_FORWARD_TO, subject, text });
    } catch (err) {
        logger.error('dailyDigest', `kunde inte mejla digesten: ${err instanceof Error ? err.message : err}`);
        return 'failed';
    }
    try {
        await supabase.from('activities').insert({
            customer_id: null, agent: 'system:daily-digest', event_type: 'system',
            action: 'digest.sent', severity: 'info',
            details: { date: stockholmParts(now).date, subject, sent: data.sent, replies: data.replies, pending_shadow: data.shadow.pendingTotal },
        });
    } catch (err) {
        logger.warn('dailyDigest', `digesten gick men kunde inte loggas: ${err instanceof Error ? err.message : err}`);
    }
    logger.info('dailyDigest', subject);
    return 'sent';
}

/** En kontroll. Exporterad så testerna slipper vänta på timern. */
export async function maybeSendDigest(now: Date = new Date()): Promise<'sent' | 'too_early' | 'already_sent' | 'no_recipient' | 'failed'> {
    const { hour } = stockholmParts(now);
    if (hour < config.DAILY_DIGEST_HOUR) return 'too_early';
    if (await alreadySentToday(now)) return 'already_sent';
    return await sendDailyDigest(now);
}

let timer: NodeJS.Timeout | null = null;

export function startDailyDigest(intervalMs = config.DAILY_DIGEST_INTERVAL_MS): void {
    if (timer) return;
    timer = setInterval(() => {
        void maybeSendDigest().catch(err =>
            logger.error('dailyDigest', `oväntat fel: ${err instanceof Error ? err.message : err}`));
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    logger.info('dailyDigest', `digest på plats — kl ${config.DAILY_DIGEST_HOUR} svensk tid, kollar var ${Math.round(intervalMs / 60000)}:e minut`);
}

export function stopDailyDigest(): void {
    if (timer) { clearInterval(timer); timer = null; }
}
