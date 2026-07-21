/**
 * HTTP-tester för röstagentens intag (routes/voice.ts) — systemets största
 * externa yta (ElevenLabs-webhook → tool-dispatch).
 *
 * Fokus på det deterministiska kontraktet: statusspegel, input-validering
 * (tts/tools), okänt verktyg som degraderar snällt, och de lokala verktygen
 * (get_time/get_status/query_customers) som svarar utan att krascha.
 *
 * global fetch stubbas till att alltid faila, så inget test träffar riktiga
 * ElevenLabs/gateway-API:t oavsett vad som ligger i .env — de nätverksberoende
 * grenarna verifieras bara på att de faller tillbaka snällt (fel-status/-svar),
 * inte att de lyckas. Supabase mockad.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import './helpers/mockSupabase';
import voiceRouter from '../routes/voice';

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/voice', voiceRouter);
    return app;
}

const app = makeApp();

beforeAll(() => {
    // Ingen riktig HTTP-trafik i testerna.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network blocked')));
});
afterAll(() => {
    vi.unstubAllGlobals();
});

describe('GET /voice/status', () => {
    it('returnerar konfig-spegel med rätt form', async () => {
        const res = await request(app).get('/api/v1/voice/status');
        expect(res.status).toBe(200);
        expect(typeof res.body.configured).toBe('boolean');
        expect(typeof res.body.gateway?.configured).toBe('boolean');
    });
});

describe('GET /voice/signed-url', () => {
    it('nätverksfel/ej konfigurerad → felstatus med error-fält (kraschar inte)', async () => {
        const res = await request(app).get('/api/v1/voice/signed-url');
        expect([500, 503]).toContain(res.status);
        expect(typeof res.body.error).toBe('string');
    });
});

describe('POST /voice/tts', () => {
    it('utan text → 400', async () => {
        const res = await request(app).post('/api/v1/voice/tts').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/text is required/i);
    });

    it('med text → svarar med felstatus när TTS inte kan nås (aldrig 200-audio mot fejk)', async () => {
        const res = await request(app).post('/api/v1/voice/tts').send({ text: 'hej' });
        expect([500, 502, 503]).toContain(res.status);
        expect(typeof res.body.error).toBe('string');
    });
});

describe('POST /voice/tools — validering & lokala verktyg', () => {
    it('utan tool_name → 400', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/tool_name is required/i);
    });

    it('okänt verktyg → 200 med snäll degradering', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({ tool_name: 'bogus_tool' });
        expect(res.status).toBe(200);
        expect(res.body.result).toMatch(/finns inte/i);
    });

    it('get_time → 200 med klockslag', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({ tool_name: 'get_time' });
        expect(res.status).toBe(200);
        expect(res.body.result).toMatch(/Klockan är/i);
    });

    it('get_status → 200 med online-svar', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({ tool_name: 'get_status' });
        expect(res.status).toBe(200);
        expect(res.body.result).toMatch(/online/i);
    });

    it('query_customers → 200 med sträng-svar (kraschar inte utan data)', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({ tool_name: 'query_customers' });
        expect(res.status).toBe(200);
        expect(typeof res.body.result).toBe('string');
    });

    it('ElevenLabs { question } utan tool_name mappas till ask_alex (kraschar inte)', async () => {
        const res = await request(app).post('/api/v1/voice/tools').send({ question: 'hur mår du?' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('result');
    });
});
