/** SCC-47 — mallrendering för MarinMekaniker-ordernotisen (portad från n8n). Inga nätanrop. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/supabase', () => ({ supabase: { from: () => ({ insert: () => Promise.resolve({ error: null }) }) } }));
vi.mock('../config', () => ({ config: { SCC_API_TOKEN: 't', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b.se' } }));
vi.mock('../services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/email', () => ({ getEmailProvider: () => ({ send: vi.fn() }) }));

import { buildOrderMails, render } from './marinmekanikerWebhook';

const order = {
    order_id: 'a1b2c3', namn: 'Anna Berg', email: 'anna@example.se', telefon: '070-1234567',
    motor_typ: 'Utombordare', marke: 'Yamaha', modell: 'F150', arsmodell: 2019, motornummer: 'YX-1',
    service_interval: 2, bild_url: null, created_at: '2026-08-30T10:00:00Z',
};

describe('buildOrderMails', () => {
    it('Thomas-mejlet innehåller alla orderfält och admin-länken', () => {
        const { thomas } = buildOrderMails(order as never);
        expect(thomas.subject).toBe('Ny order: Anna Berg – Yamaha F150');
        for (const s of ['a1b2c3', 'Anna Berg', 'anna@example.se', '070-1234567', 'Utombordare', 'Yamaha', 'F150', '2019', 'YX-1', 'Vart 2 år', 'Ingen bild uppladdad', 'marinmekaniker.nu/admin']) {
            expect(thomas.html).toContain(s);
        }
        expect(thomas.html).not.toMatch(/\{\{/);
        expect(thomas.text).toContain('Order-ID: a1b2c3');
    });

    it('kundmejlet skapas bara när e-post finns', () => {
        expect(buildOrderMails({ ...order, email: null } as never).kund).toBeNull();
        const { kund } = buildOrderMails(order as never);
        expect(kund?.subject).toBe('Tack för din beställning – MarinMekaniker.nu');
        expect(kund?.html).toContain('Hej Anna Berg');
        expect(kund?.html).toContain('Yamaha F150');
        expect(kund?.html).not.toMatch(/\{\{/);
    });

    it('bildlänk renderas när bild_url finns, och HTML escapas', () => {
        const { thomas } = buildOrderMails({ ...order, bild_url: 'https://x.se/b.jpg', namn: '<b>x</b>' } as never);
        expect(thomas.html).toContain('<a href="https://x.se/b.jpg">Visa bild</a>');
        expect(thomas.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });

    it('render lämnar okända platshållare tomma', () => {
        expect(render('a {{x}} b {{y}}', { x: '1' })).toBe('a 1 b ');
    });
});
