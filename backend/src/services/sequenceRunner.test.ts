/**
 * SCC-41/42 — enhetstester för sekvensmotorns kontrollflöde (execStep).
 *
 * execStep är dispatchern som avgör vad ett steg gör och hur enrollmenten ska
 * styras (advance/wait/exit/retry). Testerna täcker riskgrenarna: samma kill
 * switch + dagsbudget som comms, skip-vid-saknad-kanal, väntematematik,
 * wait_until-offset, branch→exit och okänd steg-typ. Inga nätanrop, ingen DB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        outboundCount: 0,
        inboundCount: 0,
        contactsUpdateError: null as string | null,
    };
    const emailSend = vi.fn();
    const smsSend = vi.fn();
    return { state, emailSend, smsSend };
});

vi.mock('../config', () => ({
    config: { OUTBOUND_ENABLED: true, OUTBOUND_DAILY_LIMIT: 5 },
}));

vi.mock('./email', () => ({ getEmailProvider: () => ({ send: h.emailSend }) }));
vi.mock('./sms', () => ({ getSmsProvider: () => ({ send: h.smsSend }) }));
vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./supabase', () => ({
    supabase: {
        from(table: string) {
            if (table === 'messages') {
                return {
                    select: () => {
                        const cursor = { dir: null as string | null };
                        const chain = {
                            eq: (col: string, val: string) => {
                                if (col === 'direction') cursor.dir = val;
                                return chain;
                            },
                            gte: () => chain,
                            contains: () => chain,
                            then: (resolve: (v: unknown) => void) =>
                                resolve({
                                    count: cursor.dir === 'inbound' ? h.state.inboundCount : h.state.outboundCount,
                                    error: null,
                                }),
                        };
                        return chain;
                    },
                    insert: () => Promise.resolve({ error: null }),
                };
            }
            if (table === 'contacts') {
                return { update: () => ({ eq: () => Promise.resolve({ error: h.state.contactsUpdateError }) }) };
            }
            // activities / tasks / opportunities: enkel awaitable insert/update
            return {
                insert: () => Promise.resolve({ error: null }),
                update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
        },
    },
}));

import { execStep } from './sequenceRunner';
import { config } from '../config';

// --- fixtures ---
const contact = {
    id: 'c-1', name: 'Anna Berg', email: 'anna@example.se', phone: '070-1234567',
    custom: {}, tags: [], customer_id: 'cust-1',
};
const enr = {
    id: 'e-1', sequence_id: 's-1', contact_id: 'c-1', opportunity_id: null,
    status: 'active', current_position: 0, context: {} as Record<string, unknown>,
};
const ENROLLED_AT = '2026-07-01T00:00:00.000Z';

function step(type: string, cfg: Record<string, unknown> = {}) {
    return { id: 'st-1', sequence_id: 's-1', position: 0, type, config: cfg };
}

beforeEach(() => {
    config.OUTBOUND_ENABLED = true;
    config.OUTBOUND_DAILY_LIMIT = 5;
    h.state.outboundCount = 0;
    h.state.inboundCount = 0;
    h.state.contactsUpdateError = null;
    h.emailSend.mockReset().mockResolvedValue({ providerMessageId: 'p-1' });
    h.smsSend.mockReset().mockResolvedValue({ providerMessageId: 's-1' });
});

describe('execStep — send_email grindar (samma som comms)', () => {
    it('kill switch: OUTBOUND_ENABLED=false → failed/retry, ingen provider', async () => {
        config.OUTBOUND_ENABLED = false;
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('failed');
        expect(res.control).toBe('retry');
        expect(res.detail).toMatchObject({ reason: 'OUTBOUND_ENABLED=false' });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it('dagsbudget nådd → failed/retry, ingen provider', async () => {
        h.state.outboundCount = 5;
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('failed');
        expect(res.detail).toMatchObject({ reason: 'daily_limit' });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it('saknad e-post → skipped/advance (aldrig tyst stopp)', async () => {
        const noEmail = { ...contact, email: null, custom: {} };
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, noEmail, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.control).toBe('advance');
        expect(res.detail).toMatchObject({ reason: 'no_email' });
    });

    it('tomt ämne/body → skipped/advance empty_email', async () => {
        const res = await execStep(step('send_email', { subject: '  ', body: '' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.detail).toMatchObject({ reason: 'empty_email' });
    });

    it('lyckat: skickar renderat mail och avancerar', async () => {
        const res = await execStep(
            step('send_email', { subject: 'Hej {{first_name}}', body: 'Hörde av dig, {{name}}' }),
            enr, contact, ENROLLED_AT
        );
        expect(res.status).toBe('success');
        expect(res.control).toBe('advance');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
        expect(h.emailSend).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'anna@example.se', subject: 'Hej Anna', text: 'Hörde av dig, Anna Berg' })
        );
    });
});

describe('execStep — send_sms', () => {
    it('saknad telefon → skipped/advance no_phone', async () => {
        const noPhone = { ...contact, phone: null, custom: {} };
        const res = await execStep(step('send_sms', { text: 'hej' }), enr, noPhone, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.detail).toMatchObject({ reason: 'no_phone' });
        expect(h.smsSend).not.toHaveBeenCalled();
    });

    it('lyckat SMS avancerar', async () => {
        const res = await execStep(step('send_sms', { text: 'Hej {{first_name}}' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('success');
        expect(h.smsSend).toHaveBeenCalledWith(expect.objectContaining({ to: '070-1234567', text: 'Hej Anna' }));
    });
});

describe('execStep — väntesteg', () => {
    it('wait: räknar om timmar/dagar till ms och signalerar wait', async () => {
        const res = await execStep(step('wait', { hours: 2, days: 1 }), enr, contact, ENROLLED_AT);
        expect(res.control).toBe('wait');
        expect(res.waitMs).toBe(2 * 3_600_000 + 86_400_000);
    });

    it('wait_until: bastid i dåtid → advance (passed)', async () => {
        const past = new Date(Date.now() - 3_600_000).toISOString();
        const e = { ...enr, context: { booking_start: past } };
        const res = await execStep(step('wait_until', { relative_to: 'booking_start' }), e, contact, ENROLLED_AT);
        expect(res.control).toBe('advance');
        expect(res.detail).toMatchObject({ passed: true });
    });

    it('wait_until: bastid i framtiden → wait med positiv waitMs', async () => {
        const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
        const e = { ...enr, context: { booking_start: future } };
        const res = await execStep(step('wait_until', { relative_to: 'booking_start', offset_hours: -1 }), e, contact, ENROLLED_AT);
        expect(res.control).toBe('wait');
        expect(res.waitMs).toBeGreaterThan(0);
    });

    it('wait_until: ingen bastid → skipped/advance no_base_time', async () => {
        const res = await execStep(step('wait_until', { relative_to: 'booking_start' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.detail).toMatchObject({ reason: 'no_base_time' });
    });
});

describe('execStep — förgrening & avslut', () => {
    it('branch has_replied + then_exit, kontakten har svarat → exit', async () => {
        h.state.inboundCount = 1;
        const res = await execStep(step('branch', { condition: 'has_replied', then_exit: true }), enr, contact, ENROLLED_AT);
        expect(res.control).toBe('exit');
        expect(res.detail).toMatchObject({ met: true });
    });

    it('branch has_replied utan svar → advance', async () => {
        h.state.inboundCount = 0;
        const res = await execStep(step('branch', { condition: 'has_replied', then_exit: true }), enr, contact, ENROLLED_AT);
        expect(res.control).toBe('advance');
        expect(res.detail).toMatchObject({ met: false });
    });

    it('exit-steg → success/exit', async () => {
        const res = await execStep(step('exit'), enr, contact, ENROLLED_AT);
        expect(res.control).toBe('exit');
    });

    it('okänd steg-typ → skipped/advance (fastnar inte)', async () => {
        const res = await execStep(step('foo_bar'), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.control).toBe('advance');
    });
});
