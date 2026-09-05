/**
 * En liten Supabase-fejk i minnet, för tester som behöver se vad som faktiskt
 * HÄNDER i databasen (rader skapas, uppdateras, dedupas) och inte bara att ett
 * anrop gjordes. Stöder den delmängd av PostgREST-kedjan våra routrar använder:
 *
 *   from(t).select(cols).eq/neq/not/filter/ilike/order/limit → await → { data }
 *   .maybeSingle() / .single()
 *   from(t).insert(row | rows) [.select().single()] → { data, error }
 *   from(t).update(patch).eq(...) → { data, error }
 *
 * filter('a->>b', 'eq', v) läser jsonb-sökvägen a.b. Ingen RLS, inga joins.
 */

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

function readPath(r: Row, col: string): unknown {
    // 'metadata->>mid' → r.metadata.mid ; 'custom->>wa_id' → r.custom.wa_id
    const m = col.match(/^([a-z_]+)->>([a-z_]+)$/i);
    if (m) {
        const obj = r[m[1]];
        return obj && typeof obj === 'object' ? (obj as Row)[m[2]] : undefined;
    }
    return r[col];
}

let idSeq = 0;
export function newId(): string {
    idSeq++;
    return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
}

export class FakeSupabase {
    tables: Record<string, Row[]> = {};

    seed(table: string, rows: Row[]): void {
        this.tables[table] = rows.map(r => ({ id: newId(), ...r }));
    }

    rows(table: string): Row[] { return this.tables[table] ?? []; }

    from(table: string) {
        const self = this;
        const preds: Pred[] = [];
        let orderBy: { col: string; asc: boolean } | null = null;
        let lim: number | null = null;
        let mode: 'select' | 'insert' | 'update' = 'select';
        let payload: Row | Row[] | null = null;
        let single: 'single' | 'maybeSingle' | null = null;

        const run = () => {
            const rows = self.tables[table] ?? (self.tables[table] = []);
            if (mode === 'insert') {
                const list = (Array.isArray(payload) ? payload : [payload!]).map(r => ({ id: newId(), created_at: new Date().toISOString(), ...r }));
                rows.push(...list);
                const data = single ? list[0] : list;
                return { data, error: null };
            }
            let hits = rows.filter(r => preds.every(p => p(r)));
            if (mode === 'update') {
                for (const r of hits) Object.assign(r, payload);
                return { data: hits, error: null };
            }
            if (orderBy) {
                const { col, asc } = orderBy;
                hits = [...hits].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
            }
            if (lim !== null) hits = hits.slice(0, lim);
            if (single === 'single') return hits.length === 1 ? { data: hits[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not single' } };
            if (single === 'maybeSingle') return { data: hits[0] ?? null, error: null };
            return { data: hits, error: null };
        };

        const q: Record<string, unknown> = {
            select: () => q,
            insert: (p: Row | Row[]) => { mode = 'insert'; payload = p; return q; },
            update: (p: Row) => { mode = 'update'; payload = p; return q; },
            eq: (col: string, v: unknown) => { preds.push(r => readPath(r, col) === v); return q; },
            neq: (col: string, v: unknown) => { preds.push(r => readPath(r, col) !== v); return q; },
            not: (col: string, op: string, v: unknown) => {
                if (op === 'is' && v === null) preds.push(r => readPath(r, col) !== null && readPath(r, col) !== undefined);
                return q;
            },
            filter: (col: string, op: string, v: unknown) => {
                if (op === 'eq') preds.push(r => String(readPath(r, col) ?? '') === String(v));
                return q;
            },
            ilike: (col: string, pat: string) => {
                const needle = pat.replace(/%/g, '').toLowerCase();
                preds.push(r => String(readPath(r, col) ?? '').toLowerCase().includes(needle));
                return q;
            },
            order: (col: string, opts?: { ascending?: boolean }) => { orderBy = { col, asc: opts?.ascending !== false }; return q; },
            limit: (n: number) => { lim = n; return q; },
            single: () => { single = 'single'; return q; },
            maybeSingle: () => { single = 'maybeSingle'; return q; },
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
                try { resolve(run()); } catch (e) { if (reject) reject(e); else throw e; }
            },
        };
        return q;
    }
}
