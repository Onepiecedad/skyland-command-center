/**
 * SCC-36/39 — route-tester för /api/v1/attribution (outreach-tratt, provision,
 * bekräftelse, manuell klassning). Servicelagret mockas; det testas för sig.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const h = vi.hoisted(() => ({
    rows: [] as Record<string, unknown>[],
    confirm: vi.fn(async () => ({ ok: true })),
    override: vi.fn(async () => undefined),
    commission: vi.fn(async () => [] as Record<string, unknown>[]),
}));

vi.mock('../services/attribution', async (importActual) => {
    const actual = await importActual<typeof import('../services/attribution')>();
    return {
        ...actual,
        fetchFunnelRows: vi.fn(async () => h.rows),
        buildCommissionRows: h.commission,
        confirmBookingPaid: h.confirm,
        overrideReplyIntent: h.override,
        getContactTimeline: vi.fn(async () => null),
        buildFunnelRows: vi.fn(async () => []),
    };
});
vi.mock('../services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import attributionRouter from './attribution';

const app = express();
app.use(express.json());
app.use('/api/v1/attribution', attributionRouter);

beforeEach(() => {
    h.rows = [];
    h.confirm.mockClear(); h.override.mockClear(); h.commission.mockClear();
});

describe('GET /attribution/outreach', () => {
    it('aggregerar per ort som default', async () => {
        h.rows = [
            { enrollment_id: 'e1', area: 'göteborg', sent_count: 1, reply_count: 1, reply_intent: 'interested', booking_count: 0, opportunity_status: 'open', research_cost_usd: 0.1, score: 50 },
            { enrollment_id: 'e2', area: 'malmö', sent_count: 1, reply_count: 0, reply_intent: null, booking_count: 1, opportunity_status: 'open', research_cost_usd: 0.1, score: 70 },
        ];
        const res = await request(app).get('/api/v1/attribution/outreach');
        expect(res.status).toBe(200);
        expect(res.body.group_by).toBe('area');
        expect(res.body.rows.map((r: { key: string }) => r.key).sort()).toEqual(['göteborg', 'malmö']);
    });
    it('okänd group_by → 400', async () => {
        const res = await request(app).get('/api/v1/attribution/outreach?group_by=färg');
        expect(res.status).toBe(400);
    });
    it('format=csv ger text/csv med header', async () => {
        h.rows = [{ enrollment_id: 'e1', area: 'göteborg', sent_count: 1, reply_count: 0, reply_intent: null, booking_count: 0, opportunity_status: 'open', research_cost_usd: 0, score: 1 }];
        const res = await request(app).get('/api/v1/attribution/outreach?format=csv');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.text.split('\n')[0]).toContain('key,enrolled,sent');
    });
    it('rows=1 ger råraderna', async () => {
        h.rows = [{ enrollment_id: 'e1', area: 'x', sent_count: 0, reply_count: 0, reply_intent: null, booking_count: 0, opportunity_status: null, research_cost_usd: null, score: null }];
        const res = await request(app).get('/api/v1/attribution/outreach?rows=1');
        expect(res.body.rows[0].enrollment_id).toBe('e1');
    });
});

describe('GET /attribution/commission/:customerId', () => {
    it('summerar bokningar, attribuerade, bekräftade och provision', async () => {
        h.commission.mockResolvedValueOnce([
            { booking_id: 'b1', attributed: true, paid_confirmed_at: '2026-09-05', paid_value_sek: 2500, commission_sek: 1000 },
            { booking_id: 'b2', attributed: false, paid_confirmed_at: null, paid_value_sek: null, commission_sek: null },
        ] as unknown as Record<string, unknown>[]);
        const res = await request(app).get('/api/v1/attribution/commission/cust-1');
        expect(res.status).toBe(200);
        expect(res.body.summary).toEqual({ bookings: 2, attributed: 1, paid_confirmed: 1, paid_value_sek: 2500, commission_sek: 1000 });
    });
});

describe('POST /attribution/bookings/:id/confirm + /replies/:contactId/intent', () => {
    it('validerar och vidarebefordrar bekräftelsen', async () => {
        const res = await request(app).post('/api/v1/attribution/bookings/b1/confirm').send({ paid_value_sek: 2500, commission_sek: 1000 });
        expect(res.status).toBe(200);
        expect(h.confirm).toHaveBeenCalledWith('b1', { confirmed: true, paid_value_sek: 2500, commission_sek: 1000 });
    });
    it('negativ provision → 400', async () => {
        const res = await request(app).post('/api/v1/attribution/bookings/b1/confirm').send({ commission_sek: -5 });
        expect(res.status).toBe(400);
    });
    it('okänd bokning → 404', async () => {
        h.confirm.mockResolvedValueOnce({ ok: false, error: 'Bokningen hittades inte' });
        const res = await request(app).post('/api/v1/attribution/bookings/nope/confirm').send({});
        expect(res.status).toBe(404);
    });
    it('manuell klassning kräver giltigt intent', async () => {
        expect((await request(app).post('/api/v1/attribution/replies/c1/intent').send({ intent: 'kanske' })).status).toBe(400);
        const ok = await request(app).post('/api/v1/attribution/replies/c1/intent').send({ intent: 'other', note: 'missförstånd' });
        expect(ok.status).toBe(200);
        expect(h.override).toHaveBeenCalledWith('c1', 'other', 'missförstånd');
    });
});
