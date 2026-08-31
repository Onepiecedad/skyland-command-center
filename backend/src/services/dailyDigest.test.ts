/**
 * Plan 3.2 — enhetstester för den dagliga digesten.
 *
 * Riskerna är inte formuleringen i mejlet utan tre saker: att digesten går EN
 * gång per dag även om Render startar om containern mitt i timmen, att en trasig
 * tabell ger en lucka i stället för ett uteblivet mejl, och att en tom dag ändå
 * mejlas — tystnad går inte att skilja från ett dött system.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    sent: [] as { subject: string; text: string }[],
    activities: [] as { action: string; details: Record<string, unknown> }[],
    /** Rader per tabell. En tabell vars värde är 'throw' kastar. */
    tables: {} as Record<string, unknown[] | 'throw'>,
    digestActivities: [] as { details: Record<string, unknown> }[],
    hour: 8,
    healthThrows: false,
}));

vi.mock('./supabase', () => {
    const builder = (table: string) => {
        const rows = h.tables[table];
        if (rows === 'throw') throw new Error(`${table} nere`);
        const result = {
            data: table === 'activities' ? h.digestActivities : (rows ?? []),
            error: null,
            count: (rows ?? []).length,
        };
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'gte', 'lte', 'eq', 'in', 'limit', 'order']) {
            chain[m] = () => chain;
        }
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
        chain.insert = (row: { action: string; details: Record<string, unknown> }) => {
            h.activities.push(row);
            return Promise.resolve({ error: null });
        };
        return chain;
    };
    return { supabase: { from: builder } };
});

vi.mock('./email', () => ({
    getEmailProvider: () => ({
        send: (m: { subject: string; text: string }) => {
            h.sent.push(m);
            return Promise.resolve({ providerMessageId: 'test' });
        },
    }),
}));

vi.mock('./integrationHealth', () => ({
    checkAll: () => {
        if (h.healthThrows) return Promise.reject(new Error('hälsokollen nere'));
        return Promise.resolve([
            { name: 'resend', status: 'up', configured: true, checked_at: '' },
            { name: 'apify', status: 'down', configured: true, checked_at: '' },
            { name: 'twilio', status: 'not_configured', configured: false, checked_at: '' },
        ]);
    },
}));

vi.mock('./pollerWatchdog', () => ({
    pollerStatus: () => ({ stale: false, secondsSince: 12, lastWorker: 'alex-vps', lastSeenAt: 1, alerted: false }),
}));

vi.mock('./logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

vi.mock('../config', () => ({
    config: {
        EMAIL_FORWARD_TO: 'joakim@skylandai.se',
        DAILY_DIGEST_HOUR: 7,
        DAILY_DIGEST_INTERVAL_MS: 900000,
    },
}));

/** 2026-08-31 09:00 svensk tid. */
const MORGON = new Date('2026-08-31T07:00:00Z');
/** 2026-08-31 04:00 svensk tid — före timslaget. */
const NATT = new Date('2026-08-31T02:00:00Z');

describe('daglig digest', () => {
    let mod: typeof import('./dailyDigest');

    beforeEach(async () => {
        vi.resetModules();
        h.sent.length = 0;
        h.activities.length = 0;
        h.digestActivities.length = 0;
        h.healthThrows = false;
        h.tables = {
            messages: [
                { channel: 'email', direction: 'outbound', status: 'sent', metadata: {}, created_at: '' },
                { channel: 'email', direction: 'outbound', status: 'sent', metadata: {}, created_at: '' },
                { channel: 'email', direction: 'outbound', status: 'failed', metadata: {}, created_at: '' },
                { channel: 'email', direction: 'outbound', status: 'shadow', metadata: {}, created_at: '' },
                { channel: 'email', direction: 'inbound', status: null, metadata: {}, created_at: '' },
            ],
            contacts: [{ id: 'a' }, { id: 'b' }],
            costs: [{ cost_usd: '0.25', call_count: 3, created_at: '' }, { cost_usd: 0.5, call_count: 2, created_at: '' }],
        };
        mod = await import('./dailyDigest');
    });

    it('läser svensk tid, inte containerns', () => {
        expect(mod.stockholmParts(MORGON)).toEqual({ hour: 9, date: '2026-08-31' });
        expect(mod.stockholmParts(NATT).hour).toBe(4);
    });

    it('skickar inte före timslaget', async () => {
        expect(await mod.maybeSendDigest(NATT)).toBe('too_early');
        expect(h.sent).toHaveLength(0);
    });

    it('skickar en gång — en omstart samma morgon ger inte ett andra mejl', async () => {
        expect(await mod.maybeSendDigest(MORGON)).toBe('sent');
        expect(h.sent).toHaveLength(1);

        // Spärren ligger i activities, så den överlever att modulen laddas om.
        h.digestActivities.push({ details: { date: '2026-08-31' } });
        vi.resetModules();
        const efterOmstart = await import('./dailyDigest');
        expect(await efterOmstart.maybeSendDigest(MORGON)).toBe('already_sent');
        expect(h.sent).toHaveLength(1);
    });

    it('mejlar även en helt tom dag — tystnad går inte att skilja från ett dött system', async () => {
        h.tables = { messages: [], contacts: [], costs: [] };
        expect(await mod.maybeSendDigest(MORGON)).toBe('sent');
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0].text).toContain('Mejl skickade: 0');
    });

    it('räknar ut, in och skugga var för sig', async () => {
        const d = await mod.collectDigest(MORGON);
        expect(d.sent.email).toBe(2);
        expect(d.sent.failed).toBe(1);
        expect(d.shadow.created).toBe(1);
        expect(d.replies.inbound).toBe(1);
        expect(d.newContacts).toBe(2);
        expect(d.cost.usd).toBeCloseTo(0.75, 5);
        expect(d.cost.calls).toBe(5);
    });

    it('en trasig tabell ger en lucka, inte ett uteblivet mejl', async () => {
        h.tables.messages = 'throw';
        h.healthThrows = true;
        const r = await mod.maybeSendDigest(MORGON);
        expect(r).toBe('sent');
        expect(h.sent[0].text).toContain('Mejl skickade: 0');
        expect(h.sent[0].text).toContain('Nya kontakter: 2');
    });

    it('flaggar rubriken när något är sönder', () => {
        const bas = {
            from: '2026-08-30T05:00:00Z', to: '2026-08-31T05:00:00Z',
            sent: { email: 3, sms: 0, failed: 0 },
            shadow: { created: 2, pendingTotal: 7, judged: 0, verdicts: {} },
            replies: { inbound: 1, acted: 1, lowConfidence: 0, byIntent: { interested: 1 }, moved: 1, suppressed: 0 },
            newContacts: 0,
            poller: { stale: false, secondsSince: 4, lastWorker: 'alex-vps' },
            health: { down: [], checked: 6 },
            cost: { usd: 1.2, calls: 40 },
        };
        expect(mod.renderDigest(bas).subject.startsWith('⚠')).toBe(false);
        expect(mod.renderDigest({ ...bas, poller: { stale: true, secondsSince: 9000, lastWorker: null } })
            .subject.startsWith('⚠')).toBe(true);
        expect(mod.renderDigest({ ...bas, health: { down: ['apify (down)'], checked: 6 } })
            .subject.startsWith('⚠')).toBe(true);
    });

    it('rapporterar bara integrationer som faktiskt är nere, inte de som saknar nyckel', async () => {
        const d = await mod.collectDigest(MORGON);
        expect(d.health.down).toEqual(['apify (down)']);
        expect(d.health.checked).toBe(3);
    });

    it('säger ifrån i stället för att mejla i tomma luften utan mottagare', async () => {
        vi.resetModules();
        vi.doMock('../config', () => ({ config: { DAILY_DIGEST_HOUR: 7, DAILY_DIGEST_INTERVAL_MS: 900000 } }));
        const utanMottagare = await import('./dailyDigest');
        expect(await utanMottagare.sendDailyDigest(MORGON)).toBe('no_recipient');
        expect(h.sent).toHaveLength(0);
    });
});
