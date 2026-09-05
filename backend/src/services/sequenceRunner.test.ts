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
        suppressed: [] as { kind: string; value: string; reason: string }[],
        inserted: [] as { table: string; row: Record<string, unknown> }[],
    };
    const emailSend = vi.fn();
    const smsSend = vi.fn();
    return { state, emailSend, smsSend };
});

vi.mock('../config', () => ({
    config: { OUTBOUND_ENABLED: true, OUTBOUND_DAILY_LIMIT: 5, OUTBOUND_MODE: 'auto', TRANSACTIONAL_OUTBOUND_ENABLED: true,
        OUTREACH_WINDOW_ENABLED: false, OUTREACH_WINDOW_START_HOUR: 8, OUTREACH_WINDOW_END_HOUR: 17, OUTREACH_JITTER_MINUTES: 90 },
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
                            neq: () => chain,
                            contains: () => chain,
                            // countSentToday (5 sep) filtrerar på metadata->>approved_at
                            is: () => chain,
                            order: () => chain,
                            limit: () => Promise.resolve({ data: [], error: null }),
                            then: (resolve: (v: unknown) => void) =>
                                resolve({
                                    count: cursor.dir === 'inbound' ? h.state.inboundCount : h.state.outboundCount,
                                    error: null,
                                }),
                        };
                        return chain;
                    },
                    insert: (row: Record<string, unknown>) => {
                        h.state.inserted.push({ table, row });
                        return Promise.resolve({ error: null });
                    },
                };
            }
            if (table === 'suppression_list') {
                return {
                    select: () => ({
                        or: (expr: string) => ({
                            limit: () => {
                                const hit = h.state.suppressed.find(
                                    s => expr.includes(`kind.eq.${s.kind},value.eq.${s.value}`)
                                );
                                return Promise.resolve({ data: hit ? [hit] : [], error: null });
                            },
                        }),
                    }),
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
    h.state.suppressed = [];
    h.state.inserted = [];
    (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'auto';
    (config as unknown as { TRANSACTIONAL_OUTBOUND_ENABLED: boolean }).TRANSACTIONAL_OUTBOUND_ENABLED = true;
    (config as unknown as { OUTREACH_WINDOW_ENABLED: boolean }).OUTREACH_WINDOW_ENABLED = false;
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

describe('execStep — outbound_policy=transactional (bokningspåminnelser går ut trots kill switch)', () => {
    const email = step('send_email', { subject: 'Påminnelse', body: 'Vi ses {{first_name}}' });

    it('OUTBOUND_ENABLED=false stoppar INTE transaktionell post', async () => {
        config.OUTBOUND_ENABLED = false;
        const res = await execStep(email, enr, contact, ENROLLED_AT, 'transactional');
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
        const msg = h.state.inserted.find(i => i.table === 'messages')!;
        expect(msg.row.status).toBe('sent');
        expect((msg.row.metadata as Record<string, unknown>).policy).toBe('transactional');
    });

    it('OUTBOUND_MODE=shadow skuggar INTE transaktionell post — den skickas skarpt', async () => {
        config.OUTBOUND_ENABLED = false;
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'shadow';
        const res = await execStep(email, enr, contact, ENROLLED_AT, 'transactional');
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
        expect(h.state.inserted.some(i => i.table === 'messages' && i.row.status === 'shadow')).toBe(false);
    });

    it('dagsbudgeten gäller inte transaktionell post', async () => {
        h.state.outboundCount = 99;
        const res = await execStep(step('send_sms', { text: 'Imorgon 10:00' }), enr, contact, ENROLLED_AT, 'transactional');
        expect(res.status).toBe('success');
        expect(h.smsSend).toHaveBeenCalledTimes(1);
    });

    it('TRANSACTIONAL_OUTBOUND_ENABLED=false är dess egen kill switch → retry', async () => {
        (config as unknown as { TRANSACTIONAL_OUTBOUND_ENABLED: boolean }).TRANSACTIONAL_OUTBOUND_ENABLED = false;
        const res = await execStep(email, enr, contact, ENROLLED_AT, 'transactional');
        expect(res.status).toBe('failed');
        expect(res.control).toBe('retry');
        expect(res.detail).toMatchObject({ reason: 'TRANSACTIONAL_OUTBOUND_ENABLED=false' });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it("suppression 'existing_customer' ignoreras för transaktionell post", async () => {
        h.state.suppressed = [{ kind: 'email', value: 'anna@example.se', reason: 'existing_customer' }];
        const res = await execStep(email, enr, contact, ENROLLED_AT, 'transactional');
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
    });

    it("suppression 'bounce' stoppar ÄVEN transaktionell post", async () => {
        h.state.suppressed = [{ kind: 'email', value: 'anna@example.se', reason: 'bounce' }];
        const res = await execStep(email, enr, contact, ENROLLED_AT, 'transactional');
        expect(res.status).toBe('skipped');
        expect(res.control).toBe('exit');
        expect(res.detail).toMatchObject({ exit_reason: 'suppressed' });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it("outreach (default) stoppas fortfarande av 'existing_customer'", async () => {
        h.state.suppressed = [{ kind: 'email', value: 'anna@example.se', reason: 'existing_customer' }];
        const res = await execStep(email, enr, contact, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.control).toBe('exit');
        expect(h.emailSend).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// SCC-46 databasreaktivering: personaliserat innehåll, skuggläge, suppression
// ---------------------------------------------------------------------------

const DM = 'Hej Anna! Såg era healed results.\nHur ser beläggningen ut?\n---\nTjena igen! Kort version: provision per bokning.';
const withDm = { ...contact, custom: { dm_hook: DM } };

describe('execStep — source=contact_dm (kortets dm_hook)', () => {
    it('opener från kortet, ämnesrad från config', async () => {
        const res = await execStep(step('send_email', { source: 'contact_dm', subject: 'Snabb fråga, {{first_name}}' }), enr, withDm, ENROLLED_AT);
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledWith(expect.objectContaining({
            subject: 'Snabb fråga, Anna',
            text: 'Hej Anna! Såg era healed results.\nHur ser beläggningen ut?',
        }));
    });

    it('followup + append renderas efter texten', async () => {
        const res = await execStep(
            step('send_email', { source: 'contact_dm', part: 'followup', subject: 'Re', append: '/ Joakim' }),
            enr, withDm, ENROLLED_AT
        );
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledWith(expect.objectContaining({
            text: 'Tjena igen! Kort version: provision per bokning.\n\n/ Joakim',
        }));
    });

    it('part=bump tar custom.dm_bump, saknas → no_dm', async () => {
        const withBump = { ...contact, custom: { dm_hook: DM, dm_bump: 'Såg att kuren är fem tillfällen, hur många brukar ta alla fem?' } };
        const ok = await execStep(step('send_email', { source: 'contact_dm', part: 'bump', subject: 'Re' }), enr, withBump, ENROLLED_AT);
        expect(ok.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('fem tillfällen') }));
        const miss = await execStep(step('send_email', { source: 'contact_dm', part: 'bump', subject: 'Re' }), enr, withDm, ENROLLED_AT);
        expect(miss.detail).toMatchObject({ reason: 'no_dm', part: 'bump' });
    });

    it('kort utan dm_hook → skipped/advance no_dm, ingen provider', async () => {
        const res = await execStep(step('send_email', { source: 'contact_dm', subject: 'x' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.control).toBe('advance');
        expect(res.detail).toMatchObject({ reason: 'no_dm' });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it('dm_hook utan --- ger opener men ingen followup → followup-steget hoppas', async () => {
        const onlyOpener = { ...contact, custom: { dm_hook: 'Bara öppnare' } };
        const res = await execStep(step('send_email', { source: 'contact_dm', part: 'followup', subject: 'x' }), enr, onlyOpener, ENROLLED_AT);
        expect(res.detail).toMatchObject({ reason: 'no_dm', part: 'followup' });
    });

    it('mall med {{dm_opener}} fungerar, saknad del hoppas', async () => {
        const ok = await execStep(step('send_email', { subject: 'x', body: '{{dm_opener}}\n\nMvh' }), enr, withDm, ENROLLED_AT);
        expect(ok.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('healed results') }));
        const miss = await execStep(step('send_email', { subject: 'x', body: '{{dm_followup}}' }), enr, contact, ENROLLED_AT);
        expect(miss.detail).toMatchObject({ reason: 'no_dm' });
    });

    it('SMS med source=contact_dm tar samma text', async () => {
        const res = await execStep(step('send_sms', { source: 'contact_dm' }), enr, withDm, ENROLLED_AT);
        expect(res.status).toBe('success');
        expect(h.smsSend).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Hej Anna!') }));
    });
});

describe('execStep — OUTBOUND_MODE=shadow', () => {
    beforeEach(() => { (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'shadow'; });

    it('loggar messages.status=shadow, rör ingen provider, avancerar', async () => {
        const res = await execStep(step('send_email', { subject: 'Hej {{first_name}}', body: 'Text' }), enr, contact, ENROLLED_AT);
        expect(res).toMatchObject({ status: 'success', control: 'advance', detail: { shadow: true, to: 'anna@example.se' } });
        expect(h.emailSend).not.toHaveBeenCalled();
        const msg = h.state.inserted.find(i => i.table === 'messages')?.row;
        expect(msg).toMatchObject({ status: 'shadow', direction: 'outbound', channel: 'email', content: 'Hej Anna\n\nText' });
        expect((msg?.metadata as Record<string, unknown>).shadow).toBe(true);
    });

    it('skugga ignorerar dagsbudgeten (hela volymen ska synas)', async () => {
        h.state.outboundCount = 99;
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('success');
        expect(res.detail).toMatchObject({ shadow: true });
    });

    it('shadow öppnar INTE kill switchen: OUTBOUND_ENABLED=false vinner', async () => {
        config.OUTBOUND_ENABLED = false;
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('success');
        expect(res.detail).toMatchObject({ shadow: true });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it('SMS skuggas också', async () => {
        const res = await execStep(step('send_sms', { text: 'Hej' }), enr, contact, ENROLLED_AT);
        expect(res.detail).toMatchObject({ shadow: true, to: '070-1234567' });
        expect(h.smsSend).not.toHaveBeenCalled();
    });
});

describe('execStep — suppression_list', () => {
    it('spärrad adress → skipped + exit (suppressed), även i skuggläge', async () => {
        h.state.suppressed = [{ kind: 'email', value: 'anna@example.se', reason: 'existing_customer' }];
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'shadow';
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('skipped');
        expect(res.control).toBe('exit');
        expect(res.detail).toMatchObject({ reason: 'suppressed', exit_reason: 'suppressed' });
        expect(h.emailSend).not.toHaveBeenCalled();
        expect(h.state.inserted.find(i => i.table === 'messages')).toBeUndefined();
    });

    it('domänspärr träffar alla adresser på domänen', async () => {
        h.state.suppressed = [{ kind: 'domain', value: 'example.se', reason: 'existing_customer' }];
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.control).toBe('exit');
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it('telefon normaliseras (mellanslag/bindestreck) före uppslag', async () => {
        h.state.suppressed = [{ kind: 'phone', value: '0701234567', reason: 'opted_out' }];
        const res = await execStep(step('send_sms', { text: 'Hej' }), enr, contact, ENROLLED_AT);
        expect(res.control).toBe('exit');
        expect(h.smsSend).not.toHaveBeenCalled();
    });

    it('ingen träff → skickar som vanligt', async () => {
        h.state.suppressed = [{ kind: 'email', value: 'annan@example.org', reason: 'bounce' }];
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
    });
});

describe('execStep — arbetstidsfönster + spridning (plan 2.5)', () => {
    const W = config as unknown as { OUTREACH_WINDOW_ENABLED: boolean; OUTBOUND_MODE: string };
    const email = step('send_email', { subject: 'x', body: 'y' });
    const SAT = new Date('2026-09-05T10:00:00Z');  // lör 12:00 Sthlm
    const TUE = new Date('2026-09-01T08:00:00Z');  // tis 10:00 Sthlm

    it('lördag, live outreach → defer till måndagsfönstret, ingen provider', async () => {
        W.OUTREACH_WINDOW_ENABLED = true;
        vi.useFakeTimers(); vi.setSystemTime(SAT);
        const res = await execStep(email, enr, contact, ENROLLED_AT);
        vi.useRealTimers();
        expect(res.control).toBe('defer');
        expect(res.waitMs!).toBeGreaterThan(40 * 3_600_000);
        expect(res.detail).toMatchObject({ reason: 'outreach_window' });
        expect(h.emailSend).not.toHaveBeenCalled();
    });

    it('vardag i fönstret, ej spridd → defer 1–90 min; spridd → skickar', async () => {
        W.OUTREACH_WINDOW_ENABLED = true;
        vi.useFakeTimers(); vi.setSystemTime(TUE);
        const first = await execStep(email, enr, contact, ENROLLED_AT);
        expect(first.control).toBe('defer');
        expect(first.waitMs!).toBeGreaterThanOrEqual(60_000);
        expect(first.waitMs!).toBeLessThanOrEqual(90 * 60_000);
        const spread = { ...enr, context: { spread_pos: 0 } };
        const second = await execStep(email, spread, contact, ENROLLED_AT);
        vi.useRealTimers();
        expect(second.status).toBe('success');
        expect(second.control).toBe('advance');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
    });

    it('transactional berörs inte av fönstret (lördag → skickar)', async () => {
        W.OUTREACH_WINDOW_ENABLED = true;
        vi.useFakeTimers(); vi.setSystemTime(SAT);
        const res = await execStep(email, enr, contact, ENROLLED_AT, 'transactional');
        vi.useRealTimers();
        expect(res.status).toBe('success');
        expect(h.emailSend).toHaveBeenCalledTimes(1);
    });

    it('skuggläge berörs inte av fönstret (lördag → skuggrad direkt)', async () => {
        W.OUTREACH_WINDOW_ENABLED = true;
        W.OUTBOUND_MODE = 'shadow';
        vi.useFakeTimers(); vi.setSystemTime(SAT);
        const res = await execStep(email, enr, contact, ENROLLED_AT);
        vi.useRealTimers();
        expect(res.status).toBe('success');
        expect(h.state.inserted.some(i => i.table === 'messages' && i.row.status === 'shadow')).toBe(true);
        expect(h.emailSend).not.toHaveBeenCalled();
    });
});

describe('execStep — require_approval håller ett steg i manuell kö', () => {
    it('live-läge + require_approval → skuggrad, ingen provider', async () => {
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'auto';
        config.OUTBOUND_ENABLED = true;   // globalt läge = live
        const res = await execStep(
            step('send_email', { subject: 'x', body: 'y', require_approval: true }),
            enr, contact, ENROLLED_AT
        );
        expect(h.emailSend).not.toHaveBeenCalled();
        expect(res.control).toBe('advance');
        const msg = h.state.inserted.find(i => i.table === 'messages');
        expect(msg?.row.status).toBe('shadow');
    });

    it('live-läge utan flaggan → skickas på riktigt', async () => {
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'auto';
        config.OUTBOUND_ENABLED = true;
        const res = await execStep(step('send_email', { subject: 'x', body: 'y' }), enr, contact, ENROLLED_AT);
        expect(h.emailSend).toHaveBeenCalledTimes(1);
        expect(res.status).toBe('success');
        const msg = h.state.inserted.find(i => i.table === 'messages');
        expect(msg?.row.status).toBe('sent');
    });

    it('kill switchen vinner över flaggan: OUTBOUND_ENABLED=false → off, ingen skuggrad', async () => {
        (config as unknown as { OUTBOUND_MODE: string }).OUTBOUND_MODE = 'auto';
        config.OUTBOUND_ENABLED = false;
        const res = await execStep(
            step('send_email', { subject: 'x', body: 'y', require_approval: true }),
            enr, contact, ENROLLED_AT
        );
        expect(h.emailSend).not.toHaveBeenCalled();
        expect(res.status).toBe('failed');
        expect(h.state.inserted.find(i => i.table === 'messages')).toBeUndefined();
    });
});
