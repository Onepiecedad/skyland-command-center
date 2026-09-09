/**
 * pulse — Alex säger till av sig själv.
 *
 * Allt annat i systemet väntar på en fråga. Det här är motsatsen: en tyst
 * bevakning som skickar en rad till panelen när något faktiskt har hänt.
 * Röret finns redan (ui_action 'note' → tråden + uppläsning), så det som
 * avgör kvaliteten är urvalet: hellre tre saker om dagen som förtjänar ett
 * avbrott än en ström som lär operatören att ignorera Alex.
 *
 * Tre källor, alla med egen karens:
 *   nytt Cold Experience-lead · OpenRouter-saldot slut · något nere.
 *
 * Frontend avgör om raden LÄSES UPP; backend säger bara hur angeläget det är.
 * En tyst panel ska inte prata till ett tomt rum.
 */

import { supabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';
import { emitSystemEvent } from '../routes/eventStream';
import { openRouterCredits } from '../routes/integrations';
import { checkAll } from './integrationHealth';
import { pollerStatus } from './pollerWatchdog';

export type PulseKind = 'ce_lead' | 'credits' | 'down';

export interface PulseNote {
    kind: PulseKind;
    text: string;
    /** true = värt att avbryta för. false = visas i tråden, läses inte upp. */
    urgent: boolean;
}

const COOLDOWN_MS: Record<PulseKind, number> = {
    ce_lead: 0,               // varje nytt lead är sitt eget besked
    credits: 6 * 3600_000,    // saldot ändrar sig långsamt
    down: 3600_000,           // en nere-integration ska inte tjata varje minut
};

const state = {
    lastLeadAt: null as string | null,
    lastSent: new Map<PulseKind, number>(),
    lastDownKey: '',
};

function cooled(kind: PulseKind): boolean {
    const last = state.lastSent.get(kind) ?? 0;
    return Date.now() - last >= COOLDOWN_MS[kind];
}

/** Ett nytt lead hos Gustav är det enda som får avbryta oombett i den här omgången. */
async function checkCeLeads(): Promise<PulseNote[]> {
    const { data, error } = await supabase
        .from('ce_leads')
        .select('id, name, country, group_size, channel, created_at')
        .order('created_at', { ascending: false })
        .limit(5);
    if (error || !data?.length) return [];

    // Första rundan efter start: lär dig var vi står, larma inte om historik.
    if (!state.lastLeadAt) {
        state.lastLeadAt = data[0].created_at as string;
        return [];
    }

    const fresh = data.filter(r => (r.created_at as string) > (state.lastLeadAt as string));
    if (!fresh.length) return [];
    state.lastLeadAt = fresh[0].created_at as string;

    return fresh.reverse().map(r => {
        const namn = (r.name as string | null)?.trim() || 'Okänd gäst';
        const delar = [
            r.group_size ? `${r.group_size} personer` : null,
            (r.country as string | null) || null,
            (r.channel as string | null) || null,
        ].filter(Boolean);
        return {
            kind: 'ce_lead' as const,
            text: `Nytt lead till Cold Experience: ${namn}${delar.length ? ` (${delar.join(', ')})` : ''}.`,
            urgent: true,
        };
    });
}

/** Saldot är det enda som gör Alex helt stum, så det är värt en påminnelse. */
async function checkCredits(): Promise<PulseNote[]> {
    if (!cooled('credits')) return [];
    const c = await openRouterCredits();
    if (c.remaining_usd === null || c.remaining_usd >= 5) return [];
    const urgent = c.remaining_usd < 2;
    return [{
        kind: 'credits',
        text: urgent
            ? `Saldot på OpenRouter är nere på ${c.remaining_usd.toFixed(2)} dollar. Under två dollar slutar jag kunna svara — fyll på.`
            : `Saldot på OpenRouter är ${c.remaining_usd.toFixed(2)} dollar kvar.`,
        urgent,
    }];
}

/** Något nere: säg det en gång, inte varje minut, och bara när läget ändrats. */
async function checkDown(): Promise<PulseNote[]> {
    const [integrations, poller] = await Promise.all([checkAll(), Promise.resolve(pollerStatus())]);
    const down = integrations
        .filter(i => i.status === 'down' || i.status === 'auth_failed')
        .map(i => i.name);
    if (poller.stale) down.push('pollern på VPS:en');

    const key = down.sort().join(',');
    if (key === state.lastDownKey) return [];   // oförändrat läge, redan sagt
    state.lastDownKey = key;
    if (!down.length) return [];                // återställt: ingen ny rad, bara tystnad
    if (!cooled('down')) return [];

    return [{
        kind: 'down',
        text: down.length === 1
            ? `${down[0]} svarar inte just nu.`
            : `Flera saker svarar inte: ${down.join(', ')}.`,
        urgent: true,
    }];
}

/** En rond. Exporterad för test — inga sidoeffekter utöver de rader den skickar. */
export async function pulseOnce(): Promise<PulseNote[]> {
    const notes: PulseNote[] = [];
    for (const check of [checkCeLeads, checkCredits, checkDown]) {
        try {
            notes.push(...await check());
        } catch (err) {
            logger.warn('pulse', `${check.name}: ${err instanceof Error ? err.message : err}`);
        }
    }

    for (const note of notes) {
        state.lastSent.set(note.kind, Date.now());
        emitSystemEvent('ui_action', {
            action: 'note',
            text: note.text,
            speak: note.urgent,
            source: 'pulse',
            kind: note.kind,
        }, 'alex');
    }
    return notes;
}

let timer: NodeJS.Timeout | null = null;

export function startPulse(intervalMs = config.PULSE_INTERVAL_MS): void {
    if (timer) return;
    logger.info('pulse', `bevakning startad (var ${Math.round(intervalMs / 1000)}s)`);
    timer = setInterval(() => { void pulseOnce(); }, intervalMs);
}

export function stopPulse(): void {
    if (timer) { clearInterval(timer); timer = null; }
    state.lastLeadAt = null;
    state.lastSent.clear();
    state.lastDownKey = '';
}
