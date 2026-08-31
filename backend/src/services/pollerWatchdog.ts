/**
 * Poller-vakt (plan 3.3)
 *
 * Alex poller på VPS:en hämtar köade körningar från `/claw/pending` var 15:e sekund.
 * Slutar den — servern nere, gatewayn död, token utgången — står hela maskinen stilla
 * utan att någonting säger till. Det är den tystaste sortens fel: inget kraschar, det
 * bara slutar hända saker.
 *
 * Vakten håller ett hjärtslag i minnet och larmar via Resend när det uteblivit för
 * länge. Två val värda att förstå:
 *
 * - **Hjärtslaget ligger i minnet, inte i databasen.** Pollern anropar var 15:e sekund;
 *   en databasrad per anrop vore 5 760 skrivningar om dagen för information som är
 *   intressant i exakt ett ögonblick. Priset är att en omstart av Render nollställer
 *   det — därför larmar vakten aldrig innan servern varit uppe längre än tröskeln.
 * - **Larm bara vid tillståndsövergång.** Ett mejl när hjärtslaget dör, ett när det
 *   kommer tillbaka. En vakt som mejlar varje minut slutar man läsa efter en timme,
 *   och då är den värdelös just den dagen den har rätt.
 */
import { config } from '../config';
import { supabase } from './supabase';
import { getEmailProvider } from './email';
import { logger } from './logger';

interface WatchdogState {
    lastSeenAt: number | null;
    lastWorker: string | null;
    alerted: boolean;
    startedAt: number;
}

const state: WatchdogState = {
    lastSeenAt: null,
    lastWorker: null,
    alerted: false,
    startedAt: Date.now(),
};

/** Anropas från GET /claw/pending. Ett hjärtslag, inget mer.
 *  `at` finns bara så testerna kan simulera tid — produktionen skickar aldrig in den. */
export function notePollerSeen(worker: string, at = Date.now()): void {
    state.lastSeenAt = at;
    state.lastWorker = worker;
}

/** Läsbart läge för statusvyer och test. */
export function pollerStatus(now = Date.now()): {
    lastSeenAt: number | null;
    lastWorker: string | null;
    secondsSince: number | null;
    stale: boolean;
    alerted: boolean;
} {
    const staleMs = config.POLLER_STALE_MINUTES * 60_000;
    const since = state.lastSeenAt === null ? null : now - state.lastSeenAt;
    // Har vi aldrig sett pollern räknas uppstartstiden i stället, så en server som
    // startat och aldrig blivit anropad också hinner bli stale.
    const referenceAge = since ?? now - state.startedAt;
    return {
        lastSeenAt: state.lastSeenAt,
        lastWorker: state.lastWorker,
        secondsSince: since === null ? null : Math.round(since / 1000),
        stale: referenceAge > staleMs,
        alerted: state.alerted,
    };
}

/** Bara för test — nollställer modulens tillstånd. */
export function _resetPollerWatchdog(startedAt = Date.now()): void {
    state.lastSeenAt = null;
    state.lastWorker = null;
    state.alerted = false;
    state.startedAt = startedAt;
}

async function logActivity(action: string, severity: string, details: Record<string, unknown>): Promise<void> {
    try {
        await supabase.from('activities').insert({
            customer_id: null, agent: 'system:poller-watchdog', event_type: 'system',
            action, severity, details,
        });
    } catch (err) {
        logger.error('pollerWatchdog', `kunde inte logga aktivitet: ${err instanceof Error ? err.message : err}`);
    }
}

async function mail(subject: string, text: string): Promise<void> {
    if (!config.EMAIL_FORWARD_TO) {
        logger.warn('pollerWatchdog', 'EMAIL_FORWARD_TO saknas — larmet loggas men mejlas inte');
        return;
    }
    try {
        await getEmailProvider().send({ to: config.EMAIL_FORWARD_TO, subject, text });
    } catch (err) {
        logger.error('pollerWatchdog', `kunde inte mejla larm: ${err instanceof Error ? err.message : err}`);
    }
}

/** En kontroll. Exporterad så testerna slipper vänta på timern. */
export async function checkPollerHeartbeat(now = Date.now()): Promise<'ok' | 'alerted' | 'recovered' | 'waiting'> {
    const staleMs = config.POLLER_STALE_MINUTES * 60_000;
    const uptime = now - state.startedAt;

    // Efter en omstart är minnet tomt. Skulle vi larma direkt vore varje deploy ett
    // falsklarm. Vänta tills servern varit uppe längre än tröskeln.
    if (state.lastSeenAt === null && uptime <= staleMs) return 'waiting';

    const age = state.lastSeenAt === null ? uptime : now - state.lastSeenAt;
    const minutes = Math.round(age / 60_000);

    if (age > staleMs) {
        if (state.alerted) return 'alerted';
        state.alerted = true;
        const seen = state.lastSeenAt === null
            ? `aldrig sedan servern startade (${minutes} min)`
            : `senast för ${minutes} min sedan`;
        await logActivity('poller.heartbeat.stale', 'error', {
            minutes_since: minutes, last_worker: state.lastWorker,
        });
        await mail(
            '[SCC] Alex poller har tystnat',
            `Pollern har inte hämtat från /claw/pending på ${minutes} minuter (${seen}).\n\n` +
            `Senaste worker: ${state.lastWorker ?? 'okänd'}\n` +
            `Tröskel: ${config.POLLER_STALE_MINUTES} min\n\n` +
            'Det betyder att köade körningar blir liggande. Kolla i den ordningen:\n' +
            '  1. Är VPS:en uppe?           ssh alex@62.238.113.151\n' +
            '  2. Kör tjänsterna?           systemctl --user is-active openclaw-gateway scc-poller\n' +
            '  3. Vad säger pollerloggen?   tail -20 ~/.openclaw/logs/poller.err\n' +
            '  4. Är SCC_API_TOKEN giltig?  cd ~/.openclaw/skills/scc-crm/scripts && python3 env.py --check\n',
        );
        logger.error('pollerWatchdog', `pollern tyst i ${minutes} min — larm skickat`);
        return 'alerted';
    }

    if (state.alerted) {
        state.alerted = false;
        await logActivity('poller.heartbeat.recovered', 'info', { last_worker: state.lastWorker });
        await mail(
            '[SCC] Alex poller är tillbaka',
            `Pollern hämtar igen. Senaste worker: ${state.lastWorker ?? 'okänd'}.\n` +
            'Köade körningar plockas upp som vanligt.\n',
        );
        logger.info('pollerWatchdog', 'pollern tillbaka — återställningsmejl skickat');
        return 'recovered';
    }

    return 'ok';
}

let timer: NodeJS.Timeout | null = null;

export function startPollerWatchdog(intervalMs = config.POLLER_WATCHDOG_INTERVAL_MS): void {
    if (timer) return;
    state.startedAt = Date.now();
    logger.info('pollerWatchdog',
        `vakt startad (tröskel ${config.POLLER_STALE_MINUTES} min, koll var ${Math.round(intervalMs / 1000)}s)`);
    timer = setInterval(() => { void checkPollerHeartbeat(); }, intervalMs);
}

export function stopPollerWatchdog(): void {
    if (timer) { clearInterval(timer); timer = null; }
}
