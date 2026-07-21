/**
 * HTTP-tester för de interna routrarna archive + errorRecovery (0 %-fläckar).
 *
 * Samma tre regressionsklasser som kärn-routrarna: global auth skyddar dem
 * (401), zod-validering avvisar trasig body/query (400), och okända id:n ger
 * 404. Supabase mockad; sido­effekter (fs-skanning, faktiska retries) testas
 * inte här.
 */

import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import './helpers/mockSupabase';
import { authMiddleware } from '../middleware/auth';
import { globalLimiter } from '../middleware/rateLimiter';
import archiveRouter from '../routes/archive';
import errorRecoveryRouter from '../routes/errorRecovery';

const TOKEN = 'test-token-abc123';
const auth = { Authorization: `Bearer ${TOKEN}` };
const UUID = '00000000-0000-0000-0000-000000000000';

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use(globalLimiter);
    app.use('/api/v1', authMiddleware);
    app.use('/api/v1/archive', archiveRouter);
    app.use('/api/v1/recovery', errorRecoveryRouter);
    return app;
}

const app = makeApp();

describe('archive-routern', () => {
    it('GET /files utan token → 401', async () => {
        expect((await request(app).get('/api/v1/archive/files')).status).toBe(401);
    });

    it('GET /files?limit=0 → 400 (limit min 1)', async () => {
        const res = await request(app).get('/api/v1/archive/files?limit=0').set(auth);
        expect(res.status).toBe(400);
    });

    it('POST /files med tom body → 400 (filename krävs)', async () => {
        const res = await request(app).post('/api/v1/archive/files').set(auth).send({});
        expect(res.status).toBe(400);
    });

    it('GET /files/:id → 404 när filen saknas', async () => {
        const res = await request(app).get(`/api/v1/archive/files/${UUID}`).set(auth);
        expect(res.status).toBe(404);
    });
});

describe('errorRecovery-routern', () => {
    it('GET /errors utan token → 401', async () => {
        expect((await request(app).get('/api/v1/recovery/errors')).status).toBe(401);
    });

    it('GET /rules med token → 200', async () => {
        const res = await request(app).get('/api/v1/recovery/rules').set(auth);
        expect(res.status).toBe(200);
    });

    it('POST /rules med tom body → 400 (recovery_action krävs)', async () => {
        const res = await request(app).post('/api/v1/recovery/rules').set(auth).send({});
        expect(res.status).toBe(400);
    });

    it('POST /rules med ogiltig recovery_action → 400', async () => {
        const res = await request(app).post('/api/v1/recovery/rules').set(auth)
            .send({ pattern: { agent: 'x' }, recovery_action: 'självförstör' });
        expect(res.status).toBe(400);
    });

    it('POST /analyze med okänt activity_id → 404', async () => {
        const res = await request(app).post('/api/v1/recovery/analyze').set(auth).send({ activity_id: UUID });
        expect(res.status).toBe(404);
    });

    it('POST /retry med okänt run_id → 404', async () => {
        const res = await request(app).post('/api/v1/recovery/retry').set(auth).send({ run_id: UUID });
        expect(res.status).toBe(404);
    });
});
