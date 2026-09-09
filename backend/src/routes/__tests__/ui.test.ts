/**
 * HTTP-ingången för skärmstyrning. Det viktiga är inte att den fungerar —
 * det är att den INTE gör något annat: bara skärmverktyg, aldrig dataändring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({ executeToolCall: vi.fn() }));
vi.mock('../../llm/tools', () => ({ executeToolCall: h.executeToolCall }));

import uiRouter from '../ui';

const app = express();
app.use(express.json());
app.use('/api/v1/ui', uiRouter);

beforeEach(() => {
    h.executeToolCall.mockReset().mockResolvedValue({ success: true, data: { view: 'crm' } });
});

describe('POST /api/v1/ui', () => {
    it('kör navigate_ui som standard och skickar argumenten vidare', async () => {
        const r = await request(app).post('/api/v1/ui').send({ args: { customer_query: 'thomas', customer_tab: 'website' } });
        expect(r.status).toBe(200);
        expect(h.executeToolCall).toHaveBeenCalledWith('navigate_ui', { customer_query: 'thomas', customer_tab: 'website' });
    });

    it('tillåter present_screens', async () => {
        await request(app).post('/api/v1/ui').send({ verktyg: 'present_screens', args: { steps: [{ view: 'crm', say: 'hej' }] } });
        expect(h.executeToolCall).toHaveBeenCalledWith('present_screens', expect.any(Object));
    });

    it('vägrar allt som inte är skärmstyrning', async () => {
        for (const verktyg of ['update_contact', 'move_opportunity', 'delegate_task', 'enroll_in_sequence']) {
            const r = await request(app).post('/api/v1/ui').send({ verktyg, args: {} });
            expect(r.status, verktyg).toBe(400);
        }
        expect(h.executeToolCall).not.toHaveBeenCalled();
    });

    it('svarar 409 när verktyget säger nej, utan att låtsas att det gick', async () => {
        h.executeToolCall.mockResolvedValueOnce({ success: false, error: 'Hittade ingen kontakt' });
        const r = await request(app).post('/api/v1/ui').send({ args: { contact_query: 'finns inte' } });
        expect(r.status).toBe(409);
        expect(r.body.error).toMatch(/Hittade ingen/);
    });
});
