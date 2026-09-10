/**
 * Claw-kön: panelens knappar när gatewayn inte går att nå.
 *
 * Render kan varken nå gatewayns loopback-port eller köra `openclaw`-CLI:t, så
 * "Kör nu" och av/på skriver i stället en rad i `gateway_commands` som VPS:en
 * dränerar. Testerna nedan låser fast det som är lätt att göra fel: att en
 * köad knapptryckning inte får se ut som ett misslyckande (202, inte 501/500),
 * att en dubbeltryckning inte blir ett fel, att ett okänt jobb blir 404, och
 * att kön faktiskt claimas när VPS:en hämtar den — annars kör två pollningar
 * samma jobb två gånger.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

type Svar = { data: unknown; error: unknown };

const state = vi.hoisted(() => ({
    kö: {} as Record<string, Svar[]>,
    anrop: [] as { table: string; op: string; arg: unknown }[],
}));

function kedja(table: string) {
    const nästa = (): Svar => state.kö[table]?.shift() ?? { data: null, error: null };
    const spara = (op: string, arg?: unknown) => state.anrop.push({ table, op, arg });
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'gte']) {
        self[m] = (...a: unknown[]) => { spara(m, a[1] ?? a[0]); return self; };
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
        self[m] = (arg?: unknown) => { spara(m, arg); return self; };
    }
    self.single = () => Promise.resolve(nästa());
    self.maybeSingle = () => Promise.resolve(nästa());
    self.then = (res: (v: Svar) => void) => res(nästa());
    return self;
}

vi.mock('../services/supabase', () => ({
    supabase: { from: (t: string) => kedja(t) },
}));

const { default: automationsRouter } = await import('./automations');

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/v1/automations', automationsRouter);
    return a;
}

function köa(table: string, ...svar: Svar[]) {
    state.kö[table] = [...(state.kö[table] ?? []), ...svar];
}

const jobbFinns = () => köa('gateway_cron_jobs', { data: { name: 'Kundvakt' }, error: null });
const jobbSaknas = () => köa('gateway_cron_jobs', { data: null, error: null });

beforeEach(() => {
    state.kö = {};
    state.anrop = [];
});

describe('automations: köa körning', () => {
    it('svarar 202 och köar i stället för att låtsas att det inte gick', async () => {
        jobbFinns();
        köa('gateway_commands', { data: { id: 'cmd-1' }, error: null });

        const r = await request(app()).post('/api/v1/automations/kundvakt/run').send({});

        expect(r.status).toBe(202);
        expect(r.body.ok).toBe(true);
        expect(r.body.queued).toBe(true);
        expect(r.body.commandId).toBe('cmd-1');

        const insert = state.anrop.find((a) => a.table === 'gateway_commands' && a.op === 'insert');
        expect(insert?.arg).toMatchObject({ kind: 'run', job_id: 'kundvakt', job_name: 'Kundvakt' });
    });

    it('ger 404 när jobbet inte finns i speglingen', async () => {
        jobbSaknas();
        const r = await request(app()).post('/api/v1/automations/finns-ej/run').send({});
        expect(r.status).toBe(404);
        expect(state.anrop.some((a) => a.table === 'gateway_commands' && a.op === 'insert')).toBe(false);
    });

    it('dubbeltryckning är inget fel — kommandot ligger redan i kön', async () => {
        jobbFinns();
        köa('gateway_commands', { data: null, error: { message: 'duplicate key value violates unique constraint' } });

        const r = await request(app()).post('/api/v1/automations/kundvakt/run').send({});

        expect(r.status).toBe(202);
        expect(r.body.ok).toBe(true);
        expect(r.body.redan).toBe(true);
    });

    it('låter riktiga databasfel bli 500, inte ett tyst "köad"', async () => {
        jobbFinns();
        köa('gateway_commands', { data: null, error: { message: 'connection refused' } });

        const r = await request(app()).post('/api/v1/automations/kundvakt/run').send({});

        expect(r.status).toBe(500);
        expect(r.body.ok).toBe(false);
    });
});

describe('automations: köa av/på', () => {
    it('enabled:true blir kind=enable', async () => {
        jobbFinns();
        köa('gateway_commands', { data: { id: 'c' }, error: null });
        const r = await request(app()).post('/api/v1/automations/kundvakt/toggle').send({ enabled: true });
        expect(r.status).toBe(202);
        expect(state.anrop.find((a) => a.op === 'insert')?.arg).toMatchObject({ kind: 'enable' });
    });

    it('enabled:false blir kind=disable', async () => {
        jobbFinns();
        köa('gateway_commands', { data: { id: 'c' }, error: null });
        await request(app()).post('/api/v1/automations/kundvakt/toggle').send({ enabled: false });
        expect(state.anrop.find((a) => a.op === 'insert')?.arg).toMatchObject({ kind: 'disable' });
    });
});

describe('automations: VPS:en dränerar kön', () => {
    it('claimar raderna den lämnar ut, så nästa pollning inte kör om dem', async () => {
        köa('gateway_commands',
            { data: [{ id: 'a', kind: 'run', job_id: 'j1' }, { id: 'b', kind: 'enable', job_id: 'j2' }], error: null },
            { data: null, error: null });

        const r = await request(app()).get('/api/v1/automations/commands/pending');

        expect(r.status).toBe(200);
        expect(r.body.commands).toHaveLength(2);
        const upd = state.anrop.find((a) => a.op === 'update');
        expect(upd?.arg).toMatchObject({ status: 'claimed' });
        expect(state.anrop.find((a) => a.op === 'in')?.arg).toEqual(['a', 'b']);
    });

    it('rör ingenting när kön är tom', async () => {
        köa('gateway_commands', { data: [], error: null });
        const r = await request(app()).get('/api/v1/automations/commands/pending');
        expect(r.body.commands).toEqual([]);
        expect(state.anrop.some((a) => a.op === 'update')).toBe(false);
    });

    it('skriver done vid lyckat resultat', async () => {
        köa('gateway_commands', { data: null, error: null });
        const r = await request(app())
            .post('/api/v1/automations/commands/abc/result')
            .send({ ok: true, result: 'kördes' });
        expect(r.status).toBe(200);
        expect(state.anrop.find((a) => a.op === 'update')?.arg).toMatchObject({ status: 'done', result: 'kördes' });
    });

    it('skriver failed med felet så panelen kan visa varför', async () => {
        köa('gateway_commands', { data: null, error: null });
        await request(app())
            .post('/api/v1/automations/commands/abc/result')
            .send({ ok: false, error: 'job not found' });
        expect(state.anrop.find((a) => a.op === 'update')?.arg)
            .toMatchObject({ status: 'failed', error: 'job not found' });
    });

    it('avvisar resultat utan ok-flagga', async () => {
        const r = await request(app()).post('/api/v1/automations/commands/abc/result').send({ result: 'hm' });
        expect(r.status).toBe(400);
    });
});
