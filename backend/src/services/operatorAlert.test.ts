/**
 * Plan 3.1 — tester för operatörslarmet.
 *
 * Riskgrenarna: att larmet aldrig kan fälla det anropande flödet, att samma
 * händelse inte spammar telefonen, och att mejlvägen går fram även när
 * WhatsApp-vägen (gatewayen) inte gör det.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    state: {
        existingAlerts: [] as unknown[],
        dedupeError: null as { message: string } | null,
        taskInsert: { data: { id: 'task-1' } as { id: string } | null, error: null as { message: string } | null },
        dispatch: { success: true, error: undefined as string | undefined },
        mailThrows: false,
    },
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    mails: [] as { to: string; subject: string; text: string }[],
    dispatched: [] as string[],
}));

vi.mock('./supabase', () => ({
    supabase: {
        from(table: string) {
            const b: Record<string, unknown> = {};
            for (const m of ['select', 'eq', 'contains', 'gte', 'order']) b[m] = () => b;
            b.limit = () => Promise.resolve({ data: h.state.existingAlerts, error: h.state.dedupeError });
            b.insert = (row: Record<string, unknown>) => {
                h.inserted.push({ table, row });
                return {
                    select: () => ({ single: () => Promise.resolve({ data: h.state.taskInsert.data, error: h.state.taskInsert.error }) }),
                    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
                };
            };
            return b;
        },
    },
}));

vi.mock('./email', () => ({
    getEmailProvider: () => ({
        send: (m: { to: string; subject: string; text: string }) => {
            if (h.state.mailThrows) return Promise.reject(new Error('Resend nere'));
            h.mails.push(m);
            return Promise.resolve({ providerMessageId: 'test' });
        },
    }),
}));

vi.mock('./taskService', () => ({
    dispatchTask: (id: string) => { h.dispatched.push(id); return Promise.resolve(h.state.dispatch); },
}));

vi.mock('./logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

vi.mock('../config', () => ({
    config: {
        OPERATOR_ALERTS_ENABLED: true,
        OPERATOR_WHATSAPP_TO: '+46737329083',
        EMAIL_FORWARD_TO: 'joakim@skylandai.se',
        SCC_PUBLIC_BASE_URL: 'https://scc.skylandai.se',
    },
}));

import { alertOperator, formatAlert } from './operatorAlert';
import { config } from '../config';

const alert = {
    kind: 'reply.interested',
    title: 'Intresserat svar: Ambers Laserklinik',
    body: 'Från: amber@x.se\nJa, berätta mer!',
    contactId: 'c-1',
    customerId: null,
    dedupeKey: 'reply.interested:c-1',
    url: 'https://scc.skylandai.se/#/crm?contact=c-1',
};

beforeEach(() => {
    h.state.existingAlerts = [];
    h.state.dedupeError = null;
    h.state.taskInsert = { data: { id: 'task-1' }, error: null };
    h.state.dispatch = { success: true, error: undefined };
    h.state.mailThrows = false;
    h.inserted.length = 0; h.mails.length = 0; h.dispatched.length = 0;
    (config as unknown as { OPERATOR_ALERTS_ENABLED: boolean }).OPERATOR_ALERTS_ENABLED = true;
    (config as unknown as { OPERATOR_WHATSAPP_TO?: string }).OPERATOR_WHATSAPP_TO = '+46737329083';
    (config as unknown as { EMAIL_FORWARD_TO?: string }).EMAIL_FORWARD_TO = 'joakim@skylandai.se';
});

describe('alertOperator — båda vägarna', () => {
    it('köar WhatsApp via claw:notify och mejlar, och loggar larmet', async () => {
        const r = await alertOperator(alert);
        expect(r).toMatchObject({ sent: true, whatsapp: 'queued', email: 'sent', deduped: false });

        const task = h.inserted.find(i => i.table === 'tasks')!;
        expect(task.row).toMatchObject({ executor: 'claw:notify', status: 'created', priority: 'high' });
        expect(task.row.input).toMatchObject({ channel: 'whatsapp', to: '+46737329083' });
        expect(String((task.row.input as { text: string }).text)).toContain('Ambers Laserklinik');
        expect(h.dispatched).toEqual(['task-1']);

        expect(h.mails[0]).toMatchObject({ to: 'joakim@skylandai.se', subject: alert.title });
        expect(h.mails[0].text).toContain('Ja, berätta mer!');

        const act = h.inserted.find(i => i.table === 'activities')!;
        expect(act.row).toMatchObject({ action: 'operator.alert', severity: 'info' });
        expect(act.row.details).toMatchObject({ dedupe_key: 'reply.interested:c-1', whatsapp: 'queued', email: 'sent' });
    });

    it('mejlet går fram även när notify-uppgiften inte kan köas', async () => {
        h.state.dispatch = { success: false, error: 'gateway nere' };
        const r = await alertOperator(alert);
        expect(r).toMatchObject({ sent: true, whatsapp: 'failed', email: 'sent' });
        expect(h.mails).toHaveLength(1);
    });

    it('WhatsApp köas även när mejlet fallerar', async () => {
        h.state.mailThrows = true;
        const r = await alertOperator(alert);
        expect(r).toMatchObject({ sent: true, whatsapp: 'queued', email: 'failed' });
    });

    it('båda vägarna nere → sent=false, men kastar inte', async () => {
        h.state.dispatch = { success: false, error: 'nere' };
        h.state.mailThrows = true;
        const r = await alertOperator(alert);
        expect(r.sent).toBe(false);
        expect(h.inserted.find(i => i.table === 'activities')?.row.severity).toBe('warn');
    });
});

describe('alertOperator — dedupe och avstängning', () => {
    it('samma dedupeKey inom dygnet larmar inte igen', async () => {
        h.state.existingAlerts = [{ id: 'a-1' }];
        const r = await alertOperator(alert);
        expect(r).toMatchObject({ deduped: true, sent: false });
        expect(h.mails).toHaveLength(0);
        expect(h.dispatched).toHaveLength(0);
    });

    it('går dedupe-kollen sönder larmar vi hellre än att tiga', async () => {
        h.state.dedupeError = { message: 'timeout' };
        const r = await alertOperator(alert);
        expect(r.sent).toBe(true);
    });

    it('OPERATOR_ALERTS_ENABLED=false stänger av allt', async () => {
        (config as unknown as { OPERATOR_ALERTS_ENABLED: boolean }).OPERATOR_ALERTS_ENABLED = false;
        const r = await alertOperator(alert);
        expect(r).toMatchObject({ sent: false, whatsapp: 'skipped', email: 'skipped' });
        expect(h.inserted).toHaveLength(0);
    });

    it('utan telefonnummer hoppas WhatsApp över, mejlet går ändå', async () => {
        (config as unknown as { OPERATOR_WHATSAPP_TO?: string }).OPERATOR_WHATSAPP_TO = undefined;
        const r = await alertOperator(alert);
        expect(r).toMatchObject({ whatsapp: 'skipped', email: 'sent', sent: true });
    });
});

describe('formatAlert', () => {
    it('rubrik, brödtext och länk i den ordningen', () => {
        const t = formatAlert(alert);
        expect(t.startsWith('Intresserat svar: Ambers Laserklinik')).toBe(true);
        expect(t.endsWith('https://scc.skylandai.se/#/crm?contact=c-1')).toBe(true);
    });
    it('utan länk slutar texten med brödtexten', () => {
        expect(formatAlert({ ...alert, url: null }).endsWith('Ja, berätta mer!')).toBe(true);
    });
});
