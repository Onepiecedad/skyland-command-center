/**
 * WhatsApp-webhooken mot en databasfejk i minnet. Det som testas är inte att
 * anrop gjordes utan vad som HÄNDE: kontakten hamnar i rätt tenant, kortet
 * skapas i första stadiet, tråden får raden, dubbletter kastas, och
 * annonsattributionen skrivs en gång och aldrig över.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { FakeSupabase } from './helpers/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as { from: (t: string) => unknown } }));
vi.mock('../services/supabase', () => ({ supabase: { from: (t: string) => h.db.from(t) } }));
vi.mock('../services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/todos', () => ({ createAutoTodo: vi.fn().mockResolvedValue(undefined) }));

import { config } from '../config';
import whatsappWebhookRouter from '../routes/whatsappWebhook';

const TOKEN = 'test-token-abc123';
const SECRET = 'meta-app-secret';

function makeApp(): Express {
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));
    app.use('/api/v1/webhooks/whatsapp', whatsappWebhookRouter);
    return app;
}
const app = makeApp();

function envelope(value: Record<string, unknown>) {
    return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages',
        value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN-CE' }, ...value } }] }] };
}
function signed(body: unknown) {
    const raw = JSON.stringify(body);
    const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
    return { raw, sig };
}
async function post(body: unknown) {
    const { raw, sig } = signed(body);
    return request(app).post('/api/v1/webhooks/whatsapp')
        .set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
}

let db: FakeSupabase;
let tenantId: string;

beforeEach(() => {
    db = new FakeSupabase();
    h.db = db;
    db.seed('tenants', [
        { slug: 'skyland', status: 'active', config: {} },
        { slug: 'cold-experience', status: 'active', config: { whatsapp_phone_number_id: 'PN-CE' } },
    ]);
    tenantId = db.rows('tenants')[1].id as string;
    db.seed('pipelines', [{ tenant_id: tenantId, name: 'Cold Experience — leads', created_at: '2026-09-05T00:00:00Z' }]);
    const pipeId = db.rows('pipelines')[0].id as string;
    db.seed('stages', [
        { pipeline_id: pipeId, name: 'Ny', position: 0 },
        { pipeline_id: pipeId, name: 'Kvalificerad', position: 1 },
    ]);
    db.seed('contacts', []); db.seed('opportunities', []); db.seed('messages', []); db.seed('activities', []);
    (config as { WHATSAPP_APP_SECRET?: string }).WHATSAPP_APP_SECRET = SECRET;
    (config as { WHATSAPP_VERIFY_TOKEN?: string }).WHATSAPP_VERIFY_TOKEN = 'verify-me';
});

describe('GET — Metas verifiering', () => {
    it('rätt verify_token → challenge som text', async () => {
        const res = await request(app).get('/api/v1/webhooks/whatsapp')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' });
        expect(res.status).toBe(200);
        expect(res.text).toBe('12345');
    });
    it('fel verify_token → 403', async () => {
        const res = await request(app).get('/api/v1/webhooks/whatsapp')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'fel', 'hub.challenge': '1' });
        expect(res.status).toBe(403);
    });
});

describe('POST — auth', () => {
    it('ogiltig signatur → 401, ingenting skrivs', async () => {
        const res = await request(app).post('/api/v1/webhooks/whatsapp')
            .set('X-Hub-Signature-256', 'sha256=deadbeef').send(envelope({}));
        expect(res.status).toBe(401);
        expect(db.rows('messages')).toHaveLength(0);
    });
    it('utan APP_SECRET: Bearer-token krävs (test/manuell väg)', async () => {
        (config as { WHATSAPP_APP_SECRET?: string }).WHATSAPP_APP_SECRET = undefined;
        const noAuth = await request(app).post('/api/v1/webhooks/whatsapp').send(envelope({}));
        expect(noAuth.status).toBe(401);
        const ok = await request(app).post('/api/v1/webhooks/whatsapp')
            .set('Authorization', `Bearer ${TOKEN}`).send(envelope({}));
        expect(ok.status).toBe(200);
    });
});

const annaMsg = (mid = 'wamid.1', extra: Record<string, unknown> = {}) => envelope({
    contacts: [{ profile: { name: 'Anna Schmidt' }, wa_id: '4915112345' }],
    messages: [{ from: '4915112345', id: mid, timestamp: '1757059200', type: 'text', text: { body: 'Ist im Januar noch frei?' }, ...extra }],
});

describe('POST — ett nytt lead', () => {
    it('skapar kontakt i CE-tenanten, kort i första stadiet, rad i tråden', async () => {
        const res = await post(annaMsg());
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ messages: 1, failed: 0 });

        const c = db.rows('contacts');
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ tenant_id: tenantId, name: 'Anna Schmidt', phone: '+4915112345', source: 'whatsapp' });
        expect((c[0].custom as Record<string, unknown>).wa_id).toBe('4915112345');

        const o = db.rows('opportunities');
        expect(o).toHaveLength(1);
        expect(o[0]).toMatchObject({ tenant_id: tenantId, contact_id: c[0].id, status: 'open', stage_id: db.rows('stages')[0].id });

        const m = db.rows('messages');
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ channel: 'whatsapp', direction: 'inbound', role: 'user', content: 'Ist im Januar noch frei?', provider_message_id: 'wamid.1' });
        expect((m[0].metadata as Record<string, unknown>).contact_id).toBe(c[0].id);

        expect(db.rows('activities').map(a => a.action)).toContain('whatsapp_lead_received');
    });

    it('samma mid två gånger → en rad (Meta levererar om)', async () => {
        await post(annaMsg());
        await post(annaMsg());
        expect(db.rows('messages')).toHaveLength(1);
        expect(db.rows('contacts')).toHaveLength(1);
    });

    it('andra meddelandet från samma nummer → samma kontakt, samma kort, två rader', async () => {
        await post(annaMsg('wamid.1'));
        await post(annaMsg('wamid.2'));
        expect(db.rows('contacts')).toHaveLength(1);
        expect(db.rows('opportunities')).toHaveLength(1);
        expect(db.rows('messages')).toHaveLength(2);
    });

    it('CTWA-referral sparas på kortet vid första beröringen och skrivs aldrig över', async () => {
        await post(annaMsg('wamid.1', { referral: { source_type: 'ad', source_id: 'AD-FIRST', ctwa_clid: 'c1' } }));
        await post(annaMsg('wamid.2', { referral: { source_type: 'ad', source_id: 'AD-SECOND', ctwa_clid: 'c2' } }));
        const custom = db.rows('contacts')[0].custom as Record<string, unknown>;
        expect((custom.ad_referral as Record<string, unknown>).source_id).toBe('AD-FIRST');
        expect(db.rows('contacts')[0].source).toBe('whatsapp_ctwa');
        expect(db.rows('contacts')[0].tags).toContain('ctwa');
    });

    it('befintlig kontakt matchas på telefon med plus och lär sig wa_id', async () => {
        db.seed('contacts', [{ tenant_id: tenantId, name: 'Anna (gammal)', phone: '+49 151 12345', custom: {} }]);
        await post(annaMsg());
        const c = db.rows('contacts');
        expect(c).toHaveLength(1);
        expect((c[0].custom as Record<string, unknown>).wa_id).toBe('4915112345');
    });

    it('samma nummer i en ANNAN tenant är en annan kontakt', async () => {
        const skylandId = db.rows('tenants')[0].id as string;
        db.seed('contacts', [{ tenant_id: skylandId, name: 'Anna hos Skyland', phone: '+4915112345', custom: { wa_id: '4915112345' } }]);
        await post(annaMsg());
        expect(db.rows('contacts')).toHaveLength(2);
        expect(db.rows('contacts').filter(c => c.tenant_id === tenantId)).toHaveLength(1);
    });

    it('okänt phone_number_id → tenant ur WHATSAPP_TENANT_SLUG', async () => {
        const body = annaMsg();
        (body.entry[0].changes[0].value as { metadata: { phone_number_id: string } }).metadata.phone_number_id = 'PN-OKÄND';
        await post(body);
        expect(db.rows('contacts')[0].tenant_id).toBe(tenantId); // default-slug är cold-experience
    });

    it('tenant utan pipeline → kontakt och tråd finns, inget kort, inget krascha', async () => {
        db.seed('pipelines', []);
        const res = await post(annaMsg());
        expect(res.status).toBe(200);
        expect(res.body.failed).toBe(0);
        expect(db.rows('contacts')).toHaveLength(1);
        expect(db.rows('opportunities')).toHaveLength(0);
        expect(db.rows('messages')).toHaveLength(1);
    });
});

describe('POST — statusar på våra utgående', () => {
    it('delivered uppdaterar status och stämplar tiden; read nedgraderar inte; failed sparar felet', async () => {
        db.seed('messages', [{ channel: 'whatsapp', direction: 'outbound', status: 'sent', provider_message_id: 'wamid.out', metadata: {} }]);
        await post(envelope({ statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '10' }] }));
        expect(db.rows('messages')[0].status).toBe('delivered');
        await post(envelope({ statuses: [{ id: 'wamid.out', status: 'sent', timestamp: '9' }] }));
        expect(db.rows('messages')[0].status).toBe('delivered');
        await post(envelope({ statuses: [{ id: 'wamid.out', status: 'failed', timestamp: '11', errors: [{ code: 131047, title: 'Re-engagement message' }] }] }));
        const row = db.rows('messages')[0];
        expect(row.status).toBe('failed');
        expect((row.metadata as Record<string, unknown>).error).toBe('131047 Re-engagement message');
        expect((row.metadata as Record<string, unknown>).delivered_at).toBeDefined();
    });
    it('status för ett okänt mid → ignoreras tyst', async () => {
        const res = await post(envelope({ statuses: [{ id: 'wamid.nope', status: 'delivered', timestamp: '1' }] }));
        expect(res.status).toBe(200);
        expect(res.body.statuses).toBe(1);
    });
});
