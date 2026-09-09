/**
 * Kontoret (SCC-49): batchkortet och utfallen ur costs.
 * Det som ska hålla: räkningen ok/omkörning/fel, "pågår"-fönstret, att kortet
 * försvinner efter en timme, och att utfallen per nod kommer nyast först.
 */
import { describe, it, expect } from 'vitest';
import { summarizeBatch, outcomesByAgent, type CostRow } from './officeBatch';

const T0 = Date.parse('2026-09-09T00:00:00Z');
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

function row(min: number, contact: string, result: string, attempts = 1, model = 'researcher', cost = 0.01): CostRow {
    return { created_at: iso(min), agent: 'pipeline:prospect', model, cost_usd: cost,
        meta: { contact, result, attempts, vertical: 'beauty-reaktivering', duration_s: 300 } };
}

describe('summarizeBatch', () => {
    it('räknar ok, omkörning och fel, och märker pågående', () => {
        const rows = [row(0, 'A', 'ok'), row(5, 'B', 'ok', 2), row(10, 'C', 'failed:dm_exit_1'), row(12, 'D', 'ok')];
        const b = summarizeBatch(rows, T0 + 15 * 60_000)!;
        expect(b.label).toBe('Beauty-batch');
        expect(b).toMatchObject({ done: 2, reruns: 1, failed: 1, total: 4, running: true, lastContact: 'D' });
        expect(b.costUsd).toBeCloseTo(0.04, 4);
        expect(b.avgDurationS).toBe(300);
    });

    it('är klar men ligger kvar under en timme, sedan borta', () => {
        const rows = [row(0, 'A', 'ok')];
        expect(summarizeBatch(rows, T0 + 30 * 60_000)!.running).toBe(false);
        expect(summarizeBatch(rows, T0 + 59 * 60_000)).not.toBeNull();
        expect(summarizeBatch(rows, T0 + 61 * 60_000)).toBeNull();
    });

    it('ger ETA bara när den pågår och har ett målantal', () => {
        const rows = [row(0, 'A', 'ok'), row(5, 'B', 'ok')];
        expect(summarizeBatch(rows, T0 + 6 * 60_000)!.etaMinutes).toBeNull();
        // 300 s × 6 kvar / 3 parallella = 600 s = 10 min
        expect(summarizeBatch(rows, T0 + 6 * 60_000, 8)!.etaMinutes).toBe(10);
    });

    it('ignorerar rader som inte är pipeline-körningar', () => {
        const rows: CostRow[] = [{ created_at: iso(0), agent: 'alex', model: 'kimi', cost_usd: 1, meta: null }];
        expect(summarizeBatch(rows, T0)).toBeNull();
    });
});

describe('outcomesByAgent', () => {
    it('grupperar per utförande agent, nyast först, max fem', () => {
        const rows = [
            ...Array.from({ length: 7 }, (_, i) => row(i, `R${i}`, i === 3 ? 'failed:x' : 'ok', i === 5 ? 2 : 1)),
            row(20, 'L1', 'ok', 1, 'research-librarian'),
        ];
        const o = outcomesByAgent(rows);
        expect(o.researcher).toHaveLength(5);
        expect(o.researcher[0].contact).toBe('R6');
        expect(o.researcher.map((x) => x.result)).toEqual(['ok', 'rerun', 'ok', 'failed', 'ok']);
        expect(o['research-librarian']).toHaveLength(1);
    });
});
