/**
 * SEC-02..05 — säkerhetstester för de dörrar som stod öppna mot internet
 * fram till 2026-08-10.
 *
 * Verifierat i prod innan fixen (curl mot scc.skylandai.se):
 *   GET /api/v1/voice/status              -> 200
 *   GET /api/v1/webhooks/openwork/status  -> 200
 *   GET /api/v1/webhooks/openwork/events  -> 200
 *   GET /api/skills, /api/activities      -> 200 med data
 *
 * `POST /api/v1/voice/tools` låg i samma öppna grupp och når ask_alex →
 * gateway /hooks/agent med full skill-access plus direkta Supabase-frågor.
 *
 * Supabase är mockad; vi asserterar bara auth-utfallet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import './helpers/mockSupabase';
import voiceRouter from '../routes/voice';
import openworkWebhookRouter from '../routes/openworkWebhook';
import skillsRouter from '../routes/skills';
import activitiesRouter from '../routes/activities';
import { authMiddleware } from '../middleware/auth';
import { sharedSecretAuth } from '../middleware/sharedSecret';

const TOKEN = 'test-token-abc123'; // = SCC_API_TOKEN i testmiljön (fallback)

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/voice', voiceRouter);
    app.use('/api/v1/webhooks/openwork', openworkWebhookRouter);
    // SEC-04: legacy-routrarna bakom samma authMiddleware som i server.ts
    app.use('/api/skills', authMiddleware, skillsRouter);
    app.use('/api/activities', authMiddleware, activitiesRouter);
    return app;
}

const app = makeApp();

describe('SEC-02 /api/v1/voice — delad hemlighet', () => {
    it('GET /status utan token → 401 (låg 200 mot internet före fixen)', async () => {
        const res = await request(app).get('/api/v1/voice/status');
        expect(res.status).toBe(401);
    });

    it('POST /tools utan token → 401 (nådde ask_alex med full skill-access)', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({ tool: 'get_time' });
        expect(res.status).toBe(401);
    });

    it('fel token → 403', async () => {
        const res = await request(app)
            .get('/api/v1/voice/status')
            .set('Authorization', 'Bearer fel-token');
        expect(res.status).toBe(403);
    });

    it('token av annan längd → 403 (ingen längdläcka, ingen krasch)', async () => {
        const res = await request(app)
            .get('/api/v1/voice/status')
            .set('Authorization', 'Bearer x');
        expect(res.status).toBe(403);
    });

    it('rätt token via Bearer → auth passerar', async () => {
        const res = await request(app)
            .get('/api/v1/voice/status')
            .set('Authorization', `Bearer ${TOKEN}`);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });

    it('rätt token via x-voice-token → auth passerar (ElevenLabs-headern)', async () => {
        const res = await request(app).get('/api/v1/voice/status').set('x-voice-token', TOKEN);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });

    it('rätt token via ?token= → auth passerar', async () => {
        const res = await request(app).get(`/api/v1/voice/status?token=${TOKEN}`);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });
});

describe('SEC-03 /api/v1/webhooks/openwork — delad hemlighet', () => {
    it('GET /status utan token → 401', async () => {
        const res = await request(app).get('/api/v1/webhooks/openwork/status');
        expect(res.status).toBe(401);
    });

    it('GET /events utan token → 401', async () => {
        const res = await request(app).get('/api/v1/webhooks/openwork/events');
        expect(res.status).toBe(401);
    });

    it('POST /openwork utan token → 401', async () => {
        const res = await request(app)
            .post('/api/v1/webhooks/openwork/openwork')
            .send({ event: 'job.new', job_id: '1', title: 't', description: 'd', reward: 1, tags: [] });
        expect(res.status).toBe(401);
    });

    it('fel token → 403', async () => {
        const res = await request(app)
            .get('/api/v1/webhooks/openwork/status')
            .set('Authorization', 'Bearer fel-token');
        expect(res.status).toBe(403);
    });

    it('rätt token → auth passerar', async () => {
        const res = await request(app)
            .get('/api/v1/webhooks/openwork/status')
            .set('Authorization', `Bearer ${TOKEN}`);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });
});

describe('SEC-04 legacy /api/skills + /api/activities', () => {
    it('/api/skills utan token → 401 (returnerade data före fixen)', async () => {
        const res = await request(app).get('/api/skills');
        expect(res.status).toBe(401);
    });

    it('/api/activities utan token → 401 (returnerade data före fixen)', async () => {
        const res = await request(app).get('/api/activities');
        expect(res.status).toBe(401);
    });

    it('/api/activities med rätt token → auth passerar', async () => {
        const res = await request(app).get('/api/activities').set('Authorization', `Bearer ${TOKEN}`);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });
});

describe('sharedSecretAuth — escape hatch och saknad konfiguration', () => {
    const saved = { ...process.env };

    beforeEach(() => {
        process.env = { ...saved };
    });
    afterEach(() => {
        process.env = { ...saved };
    });

    function appWith(envName: string): Express {
        const a = express();
        a.use(express.json());
        a.use('/probe', sharedSecretAuth({ envName, label: 'probe' }));
        a.get('/probe', (_req, res) => res.json({ ok: true }));
        return a;
    }

    it('<ENV>_ENFORCED=false släpper igenom utan token (tillfällig escape hatch)', async () => {
        process.env.PROBE_TOKEN_ENFORCED = 'false';
        const res = await request(appWith('PROBE_TOKEN')).get('/probe');
        expect(res.status).toBe(200);
    });

    it('egen env-token används före SCC_API_TOKEN-fallbacken', async () => {
        process.env.PROBE_TOKEN = 'egen-hemlighet';
        const a = appWith('PROBE_TOKEN');

        const wrong = await request(a).get('/probe').set('Authorization', `Bearer ${TOKEN}`);
        expect(wrong.status).toBe(403);

        const right = await request(a).get('/probe').set('Authorization', 'Bearer egen-hemlighet');
        expect(right.status).toBe(200);
    });

    it('faller tillbaka på SCC_API_TOKEN när egen env saknas', async () => {
        delete process.env.PROBE_TOKEN;
        const res = await request(appWith('PROBE_TOKEN')).get('/probe').set('Authorization', `Bearer ${TOKEN}`);
        expect(res.status).toBe(200);
    });
});
