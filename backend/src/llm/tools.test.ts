/**
 * Ticket 21 — tester för Alex verktygslager (LLM function calling).
 *
 * Detta lager var en 0%-blind fläck. Testerna säkrar tre saker:
 *  1. Alla annonserade verktyg (ALEX_TOOLS) är faktiskt dispatchbara — ingen
 *     drift mellan schema och switch (annars anropar LLM ett "Unknown tool").
 *  2. SUGGEST-guardrailen: create_task_proposal skapar ALLTID status='review'.
 *  3. executeToolCall/formatToolResultForLLM felhantering.
 * supabase, eventStream och sequenceEvents är mockade — inga sidoeffekter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        insertPayload: null as Record<string, unknown> | null,
        single: { data: { id: 't-1', title: 'Test', status: 'review' } as Record<string, unknown> | null, error: null as unknown },
        list: { data: [] as unknown[], error: null as unknown },
        // navigate_ui: låt svaret bero på ilike-mönstret (exakt vs delsträng)
        lastIlike: '' as string,
        listFor: null as null | ((pattern: string) => { data: unknown[]; error: unknown }),
    };
    const emitSystemEvent = vi.fn();
    return { state, emitSystemEvent };
});

vi.mock('../services/supabase', () => {
    const build = () => {
        const b: Record<string, unknown> = {};
        const pass = ['select', 'eq', 'in', 'gte', 'lte', 'like', 'ilike', 'order',
            'limit', 'contains', 'neq', 'is', 'update', 'delete'];
        for (const m of pass) b[m] = () => b;
        b.ilike = (_col: string, pattern: string) => { h.state.lastIlike = pattern; return b; };
        b.or = (filter: string) => { h.state.lastIlike = filter; return b; };
        b.insert = (payload: Record<string, unknown>) => { h.state.insertPayload = payload; return b; };
        b.single = () => Promise.resolve(h.state.single);
        b.maybeSingle = () => Promise.resolve(h.state.single);
        b.then = (resolve: (v: unknown) => void) =>
            resolve(h.state.listFor ? h.state.listFor(h.state.lastIlike) : h.state.list);
        return b;
    };
    return { supabase: { from: () => build() } };
});

vi.mock('../services/sequenceEvents', () => ({ enrollContact: vi.fn(async () => ({ id: 'enr-1' })) }));
vi.mock('../routes/eventStream', () => ({ emitSystemEvent: h.emitSystemEvent }));

import { ALEX_TOOLS, executeToolCall, formatToolResultForLLM } from './tools';

beforeEach(() => {
    h.state.insertPayload = null;
    h.state.single = { data: { id: 't-1', title: 'Test', status: 'review' }, error: null };
    h.state.list = { data: [], error: null };
    h.state.listFor = null;
    h.state.lastIlike = '';
    h.emitSystemEvent.mockReset();
});

describe('ALEX_TOOLS — schema-integritet', () => {
    it('varje verktyg har namn, beskrivning och ett object-parameterschema', () => {
        for (const tool of ALEX_TOOLS) {
            expect(tool.name, 'namn').toBeTruthy();
            expect(tool.description, `${tool.name} beskrivning`).toBeTruthy();
            expect(tool.parameters?.type, `${tool.name} parameters.type`).toBe('object');
        }
    });

    it('verktygsnamnen är unika', () => {
        const names = ALEX_TOOLS.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('varje annonserat verktyg är dispatchbart (ingen drift mot switch)', async () => {
        for (const tool of ALEX_TOOLS) {
            const res = await executeToolCall(tool.name, {});
            // Får returnera valideringsfel — men ALDRIG "Unknown tool".
            expect(res.error ?? '', `${tool.name} ska vara wirad`).not.toMatch(/Unknown tool/);
        }
    });
});

describe('executeToolCall — dispatch & felhantering', () => {
    it('okänt verktyg → success:false med tydligt fel', async () => {
        const res = await executeToolCall('bogus_tool', {});
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Unknown tool: bogus_tool/);
    });

    it('navigate_ui utan argument → felmeddelande (ingen händelse emittas)', async () => {
        const res = await executeToolCall('navigate_ui', {});
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/view, contact_query eller customer_query/i);
        expect(h.emitSystemEvent).not.toHaveBeenCalled();
    });

    it('navigate_ui med giltig vy → emittar ui_action och lyckas', async () => {
        const res = await executeToolCall('navigate_ui', { view: 'leads' });
        expect(res.success).toBe(true);
        expect(h.emitSystemEvent).toHaveBeenCalledWith(
            'ui_action',
            expect.objectContaining({ action: 'navigate', view: 'leads' }),
            'alex'
        );
    });

    it('navigate_ui med contact_query → byter till kortets pipeline och rapporterar steg', async () => {
        h.state.listFor = (pattern) =>
            pattern === 'loa ink' || pattern === '%loa ink%'
                ? { data: [{ id: 'c-1', name: 'LOA Ink' }], error: null }
                : { data: [], error: null };
        h.state.single = {
            data: { pipeline_id: 'p-agency', pipeline: { name: 'Prospecting (Agency)' }, stage: { name: 'New Prospect' } },
            error: null,
        };
        const res = await executeToolCall('navigate_ui', { contact_query: 'loa ink' });
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ view: 'crm', contact_name: 'LOA Ink', pipeline: 'Prospecting (Agency)', stage: 'New Prospect' });
        expect(h.emitSystemEvent).toHaveBeenCalledWith(
            'ui_action',
            expect.objectContaining({ action: 'navigate', view: 'crm', contact_id: 'c-1', pipeline_id: 'p-agency' }),
            'alex'
        );
    });

    it('navigate_ui med tvetydigt namn → vägrar gissa, listar kandidaterna, ingen händelse', async () => {
        h.state.listFor = (pattern) =>
            pattern === '%tattoo%'
                ? { data: [{ id: 'c-1', name: 'Wicked tattoo' }, { id: 'c-2', name: 'Heidi Hay Tattoo' }], error: null }
                : { data: [], error: null };
        const res = await executeToolCall('navigate_ui', { contact_query: 'tattoo' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Wicked tattoo, Heidi Hay Tattoo/);
        expect(h.emitSystemEvent).not.toHaveBeenCalled();
    });

    it('navigate_ui med customer_query + website-flik → öppnar kunden på Hemsida', async () => {
        h.state.listFor = (pattern) =>
            pattern.startsWith('name.ilike.thomas')
                ? { data: [{ id: 'cu-1', name: 'Thomas - MarinMekaniker', site_tenant_slug: 'marinmekaniker' }], error: null }
                : { data: [], error: null };
        const res = await executeToolCall('navigate_ui', { customer_query: 'thomas', customer_tab: 'website' });
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ view: 'customers', customer: 'Thomas - MarinMekaniker', tab: 'website' });
        expect(h.emitSystemEvent).toHaveBeenCalledWith(
            'ui_action',
            expect.objectContaining({ view: 'customers', customer_id: 'cu-1', customer_tab: 'website' }),
            'alex'
        );
    });

    it('navigate_ui: kund utan sajt + website-flik → Översikt med förklaring', async () => {
        h.state.listFor = (pattern) =>
            pattern.toLowerCase().includes('%vinnie%')
                ? { data: [{ id: 'cu-2', name: 'Vinnie - All Gold Tattoo', site_tenant_slug: null }], error: null }
                : { data: [], error: null };
        const res = await executeToolCall('navigate_ui', { customer_query: 'Vinnie', customer_tab: 'website' });
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ tab: 'overview' });
        expect(String((res.data as { note?: string }).note)).toMatch(/ingen spårad hemsida/);
        expect(h.emitSystemEvent).toHaveBeenCalledWith('ui_action', expect.objectContaining({ customer_tab: 'overview' }), 'alex');
    });

    it('navigate_ui med okänt namn → tydligt fel', async () => {
        const res = await executeToolCall('navigate_ui', { contact_query: 'Finns Inte AB' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/ingen kontakt/i);
    });

    it('start_ui_tour → emittar tour-händelse', async () => {
        const res = await executeToolCall('start_ui_tour', {});
        expect(res.success).toBe(true);
        expect(h.emitSystemEvent).toHaveBeenCalledWith('ui_action', { action: 'tour' }, 'alex');
    });
});

describe('create_task_proposal — SUGGEST-guardrail', () => {
    it('kräver title och executor', async () => {
        const res = await executeToolCall('create_task_proposal', { title: 'Bara titel' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/title.*executor|executor/i);
        expect(h.state.insertPayload).toBeNull(); // inget skrivet
    });

    it('skapar ALLTID tasken med status="review" (kringgår aldrig godkännande)', async () => {
        h.state.single = { data: { id: 't-9', title: 'Ring kund', status: 'review' }, error: null };

        const res = await executeToolCall('create_task_proposal', {
            title: 'Ring kund',
            executor: 'local:echo',
        });

        expect(res.success).toBe(true);
        // Guardrailen: insert-payloaden MÅSTE ha status 'review'
        expect(h.state.insertPayload).toMatchObject({ status: 'review', title: 'Ring kund', executor: 'local:echo' });
        // Källmetadata sätts på input
        expect((h.state.insertPayload?.input as Record<string, unknown>)?.created_via).toBe('llm_tool_call');
        expect((res.data as Record<string, unknown>).status).toBe('review');
    });
});

describe('formatToolResultForLLM', () => {
    it('formaterar ett misslyckande begripligt', () => {
        const s = formatToolResultForLLM('get_contact', { success: false, error: 'hittades inte' });
        expect(s).toMatch(/get_contact.*misslyckades.*hittades inte/i);
    });

    it('hanterar success utan data', () => {
        const s = formatToolResultForLLM('list_contacts', { success: true });
        expect(s).toMatch(/inget resultat/i);
    });

    it('formaterar en skapad task med id och guardrail-meddelande', () => {
        const s = formatToolResultForLLM('create_task_proposal', {
            success: true,
            data: { task_id: 't-1', title: 'Ring kund', message: 'Kräver godkännande innan den körs.' },
        });
        expect(s).toMatch(/t-1/);
        expect(s).toMatch(/Ring kund/);
        expect(s).toMatch(/godkännande/i);
    });
});
