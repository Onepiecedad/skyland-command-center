/**
 * SEC-05 — brute-force-skydd på operatörsinloggningen.
 *
 * Före fixen skyddades POST /api/v1/auth/login bara av globalLimiter
 * (100 req/min/IP), vilket gav 100 lösenordsgissningar i minuten mot ett
 * enda operatörslösenord. Nu: 5 försök per 15 minuter och IP, och lyckade
 * inloggningar räknas inte (skipSuccessfulRequests), så normal användning
 * påverkas inte.
 *
 * OPERATOR_PASSWORD är avsiktligt osatt i testmiljön, så handlern svarar 501.
 * Det duger: limitern sitter före handlern, och 501 är inte 2xx och räknas
 * därmed som ett förbrukat försök — precis som ett felaktigt lösenord.
 */

import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import './helpers/mockSupabase';
import authRouter from '../routes/auth';

function makeApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    return app;
}

describe('SEC-05 login-limiter', () => {
    it('sjätte försöket inom fönstret → 429', async () => {
        const app = makeApp();

        for (let i = 1; i <= 5; i++) {
            const res = await request(app).post('/api/v1/auth/login').send({ password: `gissning-${i}` });
            expect(res.status, `försök ${i} skulle inte vara rate limitat`).not.toBe(429);
        }

        const blocked = await request(app).post('/api/v1/auth/login').send({ password: 'gissning-6' });
        expect(blocked.status).toBe(429);
    });

    it('limitern gäller bara /login — /me och /logout förblir öppna', async () => {
        const app = makeApp();
        const me = await request(app).get('/api/v1/auth/me');
        expect(me.status).not.toBe(429);
        const out = await request(app).post('/api/v1/auth/logout');
        expect(out.status).not.toBe(429);
    });
});
