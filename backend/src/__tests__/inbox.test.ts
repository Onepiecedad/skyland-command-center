/**
 * Inkorgen (GET /api/v1/inbox) — läsverktyget för Alex.
 *
 * Det som ska hålla: auth gäller, och sorteringen svar/dmarc/brus görs rätt,
 * eftersom det är den som gör att Alex kan skilja ett kundsvar från en
 * DMARC-rapport och en Airbnb-bekräftelse (alla tre låg i samma kö 8 sep).
 */

import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import { mockSupabase } from './helpers/mockSupabase';
import { authMiddleware } from '../middleware/auth';
import inboxRouter from '../routes/inbox';

const TOKEN = 'test-token-abc123';
const auth = { Authorization: `Bearer ${TOKEN}` };

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', authMiddleware);
    app.use('/api/v1/inbox', inboxRouter);
    return app;
}

function chain(result: { data: unknown; error: unknown }) {
    const m: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'gte', 'order', 'limit']) m[k] = () => m;
    m.then = (resolve: (v: unknown) => void) => resolve(result);
    return m;
}

const rows = [
    { id: 'm1', direction: 'inbound', channel: 'email', status: null, content: 'Hej, svårt att avgöra det då vi startade november 2025',
      metadata: { from: 'reception@nordicbtc.com', subject: 'Re: Snabb fråga', contact_id: 'c1' }, created_at: '2026-09-08T15:23:00Z' },
    { id: 'm2', direction: 'inbound', channel: 'email', status: null, content: '<zip>',
      metadata: { from: 'noreply-dmarc-support@google.com', subject: 'Report domain: coldexperience.se' }, created_at: '2026-09-08T10:25:00Z' },
    { id: 'm3', direction: 'inbound', channel: 'email', status: null, content: 'Bokning bekräftad',
      metadata: { from: 'automated@airbnb.com', subject: 'Bokning bekräftad' }, created_at: '2026-09-08T10:55:00Z' },
];

function wire() {
    mockSupabase.from.mockImplementation((t: string) => {
        if (t === 'messages') return chain({ data: rows, error: null });
        if (t === 'contacts') return chain({ data: [{ id: 'c1', name: 'Nordic Beauty Academy', status: 'working' }], error: null });
        if (t === 'activities') return chain({ data: [
            { action: 'reply.classified', created_at: '2026-09-08T15:24:00Z', details: { contact_id: 'c1', intent: 'other', confidence: 0.91 } },
        ], error: null });
        return chain({ data: [], error: null });
    });
}

const app = makeApp();

describe('GET /api/v1/inbox', () => {
    it('utan token → 401', async () => {
        expect((await request(app).get('/api/v1/inbox')).status).toBe(401);
    });

    it('sorterar svar, dmarc och brus och slår upp kortnamn + klassning', async () => {
        wire();
        const res = await request(app).get('/api/v1/inbox?since=24h').set(auth);
        expect(res.status).toBe(200);
        expect(res.body.counts).toEqual({ svar: 1, dmarc: 1, brus: 1 });
        const svar = res.body.messages.find((m: { id: string }) => m.id === 'm1');
        expect(svar.kind).toBe('svar');
        expect(svar.contact_name).toBe('Nordic Beauty Academy');
        expect(svar.classification).toEqual({ intent: 'other', confidence: 0.91, acted: true });
        expect(res.body.messages.find((m: { id: string }) => m.id === 'm2').kind).toBe('dmarc');
        expect(res.body.messages.find((m: { id: string }) => m.id === 'm3').kind).toBe('brus');
    });

    it('kind=svar filtrerar bort brus och dmarc', async () => {
        wire();
        const res = await request(app).get('/api/v1/inbox?kind=svar').set(auth);
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(res.body.messages[0].from).toBe('reception@nordicbtc.com');
    });

    it('ogiltig since faller tillbaka på 24h utan att krascha', async () => {
        wire();
        const res = await request(app).get('/api/v1/inbox?since=igår').set(auth);
        expect(res.status).toBe(200);
        expect(typeof res.body.since).toBe('string');
    });
});
