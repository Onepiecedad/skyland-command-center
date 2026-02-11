/**
 * Costs endpoint tests
 * Verifies cost data pipeline (Fas 3 verification).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Mock Supabase BEFORE importing the app
import './helpers/mockSupabase';
import { mockSupabase } from './helpers/mockSupabase';
import { createTestApp } from './helpers/testApp';

const VALID_TOKEN = 'test-token-abc123';

describe('Costs API', () => {
    let app: Express;

    beforeAll(() => {
        app = createTestApp();
    });

    describe('GET /api/v1/costs', () => {
        beforeEach(() => {
            // Mock: costs table returns sample data
            mockSupabase.from.mockReturnValue({
                select: () => ({
                    gte: () => ({
                        order: () => Promise.resolve({
                            data: [
                                {
                                    date: '2026-02-11',
                                    provider: 'openrouter',
                                    model: 'gpt-4o',
                                    agent: 'alex',
                                    tokens_in: 1500,
                                    tokens_out: 300,
                                    cost_usd: 0.025,
                                    call_count: 1,
                                },
                            ],
                            error: null,
                        }),
                    }),
                }),
            });
        });

        it('should return aggregated cost data with auth', async () => {
            const res = await request(app)
                .get('/api/v1/costs?range=7d')
                .set('Authorization', `Bearer ${VALID_TOKEN}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('daily');
            expect(res.body).toHaveProperty('providers');
            expect(res.body).toHaveProperty('agents');
            expect(res.body).toHaveProperty('monthTotal');
            expect(res.body).toHaveProperty('budget');
        });

        it('should reject request without auth', async () => {
            const res = await request(app).get('/api/v1/costs?range=7d');

            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/v1/costs', () => {
        beforeEach(() => {
            // Mock: insert returns the inserted row
            mockSupabase.from.mockReturnValue({
                insert: () => ({
                    select: () => ({
                        single: () => Promise.resolve({
                            data: {
                                id: 'test-id',
                                date: '2026-02-11',
                                provider: 'openrouter',
                                model: 'gpt-4o',
                                agent: 'alex',
                                tokens_in: 1500,
                                tokens_out: 300,
                                cost_usd: 0.025,
                                call_count: 1,
                            },
                            error: null,
                        }),
                    }),
                }),
            });
        });

        it('should accept valid cost entry', async () => {
            const res = await request(app)
                .post('/api/v1/costs')
                .set('Authorization', `Bearer ${VALID_TOKEN}`)
                .send({
                    date: '2026-02-11',
                    provider: 'openrouter',
                    model: 'gpt-4o',
                    agent: 'alex',
                    tokens_in: 1500,
                    tokens_out: 300,
                    cost_usd: 0.025,
                    call_count: 1,
                });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
        });

        it('should reject invalid cost entry (missing required fields)', async () => {
            const res = await request(app)
                .post('/api/v1/costs')
                .set('Authorization', `Bearer ${VALID_TOKEN}`)
                .send({
                    date: '2026-02-11',
                    // Missing provider, agent, cost_usd
                });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'Validation failed');
        });
    });
});
