/**
 * Kontoret (SCC-49, etapp 1–2): batchkortet och nodernas utfall, ur `costs`.
 *
 * Plan 2.4 skriver en rad per pipeline-körning (agent='pipeline:prospect',
 * model=<agent som körde>, meta={contact, vertical, attempts, duration_s, result}).
 * Det räcker som källa: inga nya skrivvägar från batch-skripten.
 *
 * Rena funktioner här; routen hämtar raderna och anropar dem. Testas utan DB.
 */

export interface CostRow {
    created_at: string;
    agent: string;
    model: string | null;
    cost_usd: number | string | null;
    meta: Record<string, unknown> | null;
}

export interface BatchSummary {
    label: string;            // "Beauty-batch"
    vertical: string | null;
    running: boolean;         // rad inom RUNNING_WINDOW_MS
    done: number;             // ok på första försöket
    reruns: number;           // ok efter omkörning (attempts > 1)
    failed: number;
    total: number;
    costUsd: number;
    avgDurationS: number | null;
    lastContact: string | null;
    lastAt: string | null;
    firstAt: string | null;
    etaMinutes: number | null; // bara när running och det finns målantal
}

export interface AgentOutcome {
    contact: string | null;
    result: 'ok' | 'rerun' | 'failed';
    at: string;
    durationS: number | null;
}

export const RUNNING_WINDOW_MS = 20 * 60_000;
export const LINGER_MS = 60 * 60_000;      // kortet ligger kvar 1 h efter sista raden
export const GLOW_MS = 10 * 60_000;        // utfallsglöd på noden

const VERTICAL_LABEL: Record<string, string> = {
    'beauty-reaktivering': 'Beauty-batch',
    beauty: 'Beauty-batch',
    tattoo: 'Tattoo-batch',
    coldexperience: 'Cold Experience',
};

function outcomeOf(meta: Record<string, unknown> | null): AgentOutcome['result'] {
    const r = String(meta?.result ?? '');
    const attempts = Number(meta?.attempts ?? 1);
    if (r === 'ok') return attempts > 1 ? 'rerun' : 'ok';
    return 'failed';
}

/** Batchkortet för dagens rader. `now` injiceras för testbarhet. */
export function summarizeBatch(rows: CostRow[], now: number = Date.now(), targetTotal?: number): BatchSummary | null {
    const pipe = rows
        .filter((r) => (r.agent || '').startsWith('pipeline:'))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (pipe.length === 0) return null;

    const last = pipe[pipe.length - 1];
    const lastAtMs = new Date(last.created_at).getTime();
    if (now - lastAtMs > LINGER_MS) return null;

    let done = 0, reruns = 0, failed = 0, cost = 0, durSum = 0, durN = 0;
    const verticals = new Map<string, number>();
    for (const r of pipe) {
        const o = outcomeOf(r.meta);
        if (o === 'ok') done++; else if (o === 'rerun') reruns++; else failed++;
        cost += Number(r.cost_usd ?? 0) || 0;
        const d = Number(r.meta?.duration_s);
        if (Number.isFinite(d) && d > 0) { durSum += d; durN++; }
        const v = String(r.meta?.vertical ?? '');
        if (v) verticals.set(v, (verticals.get(v) ?? 0) + 1);
    }
    const vertical = [...verticals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const running = now - lastAtMs < RUNNING_WINDOW_MS;
    const avg = durN ? durSum / durN : null;
    const total = pipe.length;
    // ETA = snittid × återstående / 3 parallella (ärendets formel). Utan målantal: null.
    let eta: number | null = null;
    if (running && avg && targetTotal && targetTotal > total) {
        eta = Math.round((avg * (targetTotal - total)) / 3 / 60);
    }
    return {
        label: (vertical && VERTICAL_LABEL[vertical]) || 'Batch',
        vertical,
        running,
        done, reruns, failed, total,
        costUsd: Math.round(cost * 10000) / 10000,
        avgDurationS: avg ? Math.round(avg) : null,
        lastContact: (last.meta?.contact as string | undefined) ?? null,
        lastAt: last.created_at,
        firstAt: pipe[0].created_at,
        etaMinutes: eta,
    };
}

/** Senaste utfallen per utförande agent (costs.model), nyast först, max `limit`. */
export function outcomesByAgent(rows: CostRow[], limit = 5): Record<string, AgentOutcome[]> {
    const out: Record<string, AgentOutcome[]> = {};
    const pipe = rows
        .filter((r) => (r.agent || '').startsWith('pipeline:') && r.model)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const r of pipe) {
        const id = String(r.model);
        const list = (out[id] ??= []);
        if (list.length >= limit) continue;
        const d = Number(r.meta?.duration_s);
        list.push({
            contact: (r.meta?.contact as string | undefined) ?? null,
            result: outcomeOf(r.meta),
            at: r.created_at,
            durationS: Number.isFinite(d) ? d : null,
        });
    }
    return out;
}
