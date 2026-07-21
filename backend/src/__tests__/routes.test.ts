/**
 * HTTP-tester för kärn-routrarna (contacts/pipelines/tasks/dispatch).
 *
 * Dessa satt på 0 % täckning. Testerna säkrar de tre vanligaste regressionerna
 * på route-nivå: att global auth faktiskt skyddar dem (401 utan token),
 * att zod-valideringen avvisar trasig body (400), och att okända id:n ger 404.
 * Supabase är mockad; happy-path-inserts testas i tjänste-lagret i stället.
 */

import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import './helpers/mockSupabase';
import { authMiddleware } from '../middleware/auth';
import { globalLimiter } from '../middleware/rateLimiter';
import contactsRouter from '../routes/contacts';
import pipelinesRouter from '../routes/pipelines';
import tasksRouter from '../routes/tasks';
import dispatchRouter from '../routes/dispatch';

const TOKEN = 'test-token-abc123';
const auth = { Authorization: `Bearer ${TOKEN}` };

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use(globalLimiter);
    app.use('/api/v1', authMiddleware);
    app.use('/api/v1/contacts', contactsRouter);
    app.use('/api/v1/pipelines', pipelinesRouter);
    app.use('/api/v1/tasks', tasksRouter);
    app.use('/api/v1/dispatch', dispatchRouter);
    return app;
}

const app = makeApp();

describe('Global auth skyddar kärn-routrarna', () => {
    it('GET /contacts utan token → 401', async () => {
        expect((await request(app).get('/api/v1/contacts')).status).toBe(401);
    });
    it('GET /tasks utan token → 401', async () => {
        expect((await request(app).get('/api/v1/tasks')).status).toBe(401);
    });
    it('POST /pipelines/opportunities utan token → 401', async () => {
        expect((await request(app).post('/api/v1/pipelines/opportunities').send({})).status).toBe(401);
    });
    it('fel token → 403', async () => {
        const res = await request(app).get('/api/v1/contacts').set('Authorization', 'Bearer fel');
        expect(res.status).toBe(403);
    });
});

describe('Validering (400) med giltig auth men trasig body', () => {
    it('POST /contacts med tom body → 400', async () => {
        const res = await request(app).post('/api/v1/contacts').set(auth).send({});
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
    });
    it('POST /tasks med tom body → 400', async () => {
        const res = await request(app).post('/api/v1/tasks').set(auth).send({});
        expect(res.status).toBe(400);
    });
    it('POST /pipelines/opportunities med tom body → 400', async () => {
        const res = await request(app).post('/api/v1/pipelines/opportunities').set(auth).send({});
        expect(res.status).toBe(400);
    });
    it('POST /dispatch/tasks/:id/dispatch med tom body → 400', async () => {
        const res = await request(app).post('/api/v1/dispatch/tasks/t-1/dispatch').set(auth).send({});
        expect(res.status).toBe(400);
    });
});

describe('Not found (404) för okända id:n', () => {
    it('GET /contacts/:id → 404 när kontakten saknas', async () => {
        const res = await request(app).get('/api/v1/contacts/does-not-exist').set(auth);
        expect(res.status).toBe(404);
    });
    it('GET /tasks/:id → 404 när tasken saknas', async () => {
        const res = await request(app).get('/api/v1/tasks/does-not-exist').set(auth);
        expect(res.status).toBe(404);
    });
});
