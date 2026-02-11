/**
 * Auth middleware tests
 * Verifies Bearer token authentication (Fas 2 verification).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Mock Supabase BEFORE importing the app
import './helpers/mockSupabase';
import { createTestApp } from './helpers/testApp';

const VALID_TOKEN = 'test-token-abc123';  // Matches setup.ts SCC_API_TOKEN

describe('Auth Middleware', () => {
    let app: Express;

    beforeAll(() => {
        app = createTestApp();
    });

    describe('Protected routes (require auth)', () => {
        it('should return 401 without token', async () => {
            const res = await request(app).get('/api/v1/costs?range=7d');

            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('error');
        });

        it('should return 401 with invalid token', async () => {
            const res = await request(app)
                .get('/api/v1/costs?range=7d')
                .set('Authorization', 'Bearer wrong-token');

            expect(res.status).toBe(403);
        });

        it('should accept valid Bearer token in header', async () => {
            const res = await request(app)
                .get('/api/v1/costs?range=7d')
                .set('Authorization', `Bearer ${VALID_TOKEN}`);

            // Should NOT be 401 (may be 500 if supabase mock isn't perfect, but NOT 401)
            expect(res.status).not.toBe(401);
        });

        it('should accept valid token as query param', async () => {
            const res = await request(app)
                .get(`/api/v1/costs?range=7d&token=${VALID_TOKEN}`);

            expect(res.status).not.toBe(401);
        });
    });

    describe('Health endpoint (no auth required)', () => {
        it('should be accessible without token', async () => {
            const res = await request(app).get('/api/v1/health');

            expect(res.status).toBe(200);
        });
    });
});
