/**
 * Health endpoint tests
 * Verifies that GET /health returns OK status (Fas 1 verification).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Mock Supabase BEFORE importing the app
import './helpers/mockSupabase';
import { mockSupabase } from './helpers/mockSupabase';
import { createTestApp } from './helpers/testApp';

describe('GET /api/v1/health', () => {
    let app: Express;

    beforeAll(() => {
        // Mock the health check query
        mockSupabase.from.mockReturnValue({
            select: () => ({
                limit: () => Promise.resolve({ data: [{ id: '1' }], error: null }),
            }),
        });
        app = createTestApp();
    });

    it('should return healthy status with 200', async () => {
        const res = await request(app).get('/api/v1/health');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'healthy');
        expect(res.body).toHaveProperty('timestamp');
    });

    it('should not require auth token', async () => {
        // No Authorization header — should still succeed
        const res = await request(app).get('/api/v1/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('healthy');
    });
});
