/**
 * SCC-41 — skyddstester för mergeContacts.
 *
 * En felaktig merge raderar en kontakt (steg 5). Därför måste de destruktiva
 * förutsättningarna vägra tidigt: merge med sig själv, saknad primär, saknad
 * dubblett — alla ska kasta INNAN någon rad flyttas eller raderas.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        primary: null as Record<string, unknown> | null,
        dup: null as Record<string, unknown> | null,
    };
    const calls = { deletes: 0 };
    return { state, calls };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./supabase', () => ({
    supabase: {
        from(table: string) {
            const byId = (id: string) => {
                const p = h.state.primary as { id?: string } | null;
                const d = h.state.dup as { id?: string } | null;
                if (p && p.id === id) return p;
                if (d && d.id === id) return d;
                return null;
            };
            return {
                select: () => ({
                    eq: (_col: string, id: string) => ({
                        maybeSingle: () => Promise.resolve({ data: byId(id), error: null }),
                    }),
                    contains: () => Promise.resolve({ data: [], error: null }),
                }),
                update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
                insert: () => Promise.resolve({ error: null }),
                delete: () => {
                    h.calls.deletes++;
                    return { eq: () => Promise.resolve({ error: null }) };
                },
                _table: table,
            };
        },
    },
}));

import { mergeContacts } from './contactMerge';

beforeEach(() => {
    h.state.primary = null;
    h.state.dup = null;
    h.calls.deletes = 0;
});

describe('mergeContacts — destruktiva skydd', () => {
    it('vägrar merga en kontakt med sig själv', async () => {
        await expect(mergeContacts('same-id', 'same-id')).rejects.toThrow(/sig själv/i);
        expect(h.calls.deletes).toBe(0);
    });

    it('kastar när primären saknas (raderar inget)', async () => {
        h.state.primary = null;
        h.state.dup = { id: 'dup-1', name: 'Dup', tags: [], custom: {} };
        await expect(mergeContacts('primary-x', 'dup-1')).rejects.toThrow(/prim/i);
        expect(h.calls.deletes).toBe(0);
    });

    it('kastar när dubbletten saknas (raderar inget)', async () => {
        h.state.primary = { id: 'primary-1', name: 'Primär', tags: [], custom: {} };
        h.state.dup = null;
        await expect(mergeContacts('primary-1', 'dup-x')).rejects.toThrow(/[Dd]ubblett/);
        expect(h.calls.deletes).toBe(0);
    });
});
