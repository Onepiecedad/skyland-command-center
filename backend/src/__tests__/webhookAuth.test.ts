/**
 * Säkerhetstester för de fyra pre-auth-webhookarna.
 *
 * Dessa routrar monteras FÖRE den globala Bearer-auth:en och har egna tokens
 * (fallback SCC_API_TOKEN). De är systemets öppna dörrar mot internet (n8n,
 * mejl-inbound, Cal.com, IG-DM), så varje router måste avvisa anrop utan/med
 * fel token och släppa in med rätt. Supabase är mockad; vi asserterar bara
 * auth-utfallet (aldrig 401/403 = auth passerade).
 */

import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// Mocka Supabase INNAN routrarna importeras (registrerar mock för services/supabase).
import './helpers/mockSupabase';
import leadsRouter from '../routes/leads';
import emailInboundRouter from '../routes/emailInbound';
import igDmWebhookRouter from '../routes/igDmWebhook';
import calcomWebhookRouter from '../routes/calcomWebhook';

const TOKEN = 'test-token-abc123'; // = SCC_API_TOKEN i testmiljön (fallback för alla fyra)

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/leads', leadsRouter);
    app.use('/api/v1/webhooks/email', emailInboundRouter);
    app.use('/api/v1/webhooks/ig-dm', igDmWebhookRouter);
    app.use('/api/v1/webhooks/calcom', calcomWebhookRouter);
    return app;
}

const app = makeApp();

describe('leads /intake — egen token (401/403)', () => {
    it('utan token → 401', async () => {
        const res = await request(app).post('/api/v1/leads/intake').send({ source: 'void_form' });
        expect(res.status).toBe(401);
    });
    it('felaktigt Authorization-format (utan Bearer) → 401', async () => {
        const res = await request(app).post('/api/v1/leads/intake').set('Authorization', TOKEN).send({});
        expect(res.status).toBe(401);
    });
    it('fel token → 403', async () => {
        const res = await request(app).post('/api/v1/leads/intake').set('Authorization', 'Bearer fel-token').send({});
        expect(res.status).toBe(403);
    });
    it('rätt token → auth passerar (inte 401/403)', async () => {
        const res = await request(app).post('/api/v1/leads/intake').set('Authorization', `Bearer ${TOKEN}`).send({});
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });
});

describe('inbound-mejl-webhook — egen token', () => {
    it('utan token → 401', async () => {
        const res = await request(app).post('/api/v1/webhooks/email/inbound').send({});
        expect(res.status).toBe(401);
    });
    it('rätt token via Bearer → auth passerar', async () => {
        const res = await request(app).post('/api/v1/webhooks/email/inbound').set('Authorization', `Bearer ${TOKEN}`).send({});
        expect(res.status).not.toBe(401);
    });
    it('rätt token via ?token= → auth passerar', async () => {
        const res = await request(app).post(`/api/v1/webhooks/email/inbound?token=${TOKEN}`).send({});
        expect(res.status).not.toBe(401);
    });
});

describe('IG-DM-webhook — egen token', () => {
    it('utan token → 401', async () => {
        const res = await request(app).post('/api/v1/webhooks/ig-dm').send({ username: 'x', direction: 'inbound', text: 'hej' });
        expect(res.status).toBe(401);
    });
    it('fel token → 401', async () => {
        const res = await request(app).post('/api/v1/webhooks/ig-dm').set('Authorization', 'Bearer fel').send({});
        expect(res.status).toBe(401);
    });
    it('rätt token → auth passerar (inte 401)', async () => {
        const res = await request(app).post('/api/v1/webhooks/ig-dm').set('Authorization', `Bearer ${TOKEN}`).send({});
        expect(res.status).not.toBe(401);
    });
});

describe('Cal.com-webhook — egen token', () => {
    it('utan token → 401', async () => {
        const res = await request(app).post('/api/v1/webhooks/calcom').send({});
        expect(res.status).toBe(401);
    });
    it('rätt token via Bearer → auth passerar', async () => {
        const res = await request(app).post('/api/v1/webhooks/calcom').set('Authorization', `Bearer ${TOKEN}`).send({});
        expect(res.status).not.toBe(401);
    });
    it('rätt token via ?token= → auth passerar', async () => {
        const res = await request(app).post(`/api/v1/webhooks/calcom?token=${TOKEN}`).send({});
        expect(res.status).not.toBe(401);
    });
});
