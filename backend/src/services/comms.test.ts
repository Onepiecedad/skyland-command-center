/**
 * SCC-30 — enhetstester för utskicksgrinden (executeCommsEmail).
 *
 * Detta är den dyraste koden att få fel: ett regressionsfel som skickar
 * trots avstängning eller förbi dagsbudgeten kostar pengar och rykte.
 * Testerna verifierar grindarna INNAN någon provider anropas, samt att
 * lyckat utskick loggas och räknar upp dagsvolymen.
 *
 * Inga nätanrop, ingen DB — supabase, config och e-postprovidern är mockade.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Delad, muterbar teststate (hoistas så vi.mock-factories når den).
const h = vi.hoisted(() => {
    const state = {
        outboundCount: 0,
        countError: null as string | null,
        contact: null as Record<string, unknown> | null,
        contactError: null as string | null,
        insertData: { id: 'msg-1' } as Record<string, unknown> | null,
        insertError: null as string | null,
    };
    const sendMock = vi.fn();
    return { state, sendMock };
});

// Muterbar config — samma objekt-referens som comms.ts importerar.
vi.mock('../config', () => ({
    config: { OUTBOUND_ENABLED: true, OUTBOUND_DAILY_LIMIT: 5 },
}));

vi.mock('./email', () => ({
    getEmailProvider: () => ({ send: h.sendMock }),
}));

vi.mock('./supabase', () => {
    const { state } = h;
    return {
        supabase: {
            from(table: string) {
                if (table === 'messages') {
                    return {
                        // countOutboundToday: .select(...).eq().gte() → { count, error }
                        select() {
                            const chain = {
                                eq: () => chain,
                                gte: () => chain,
                                then: (resolve: (v: unknown) => void) =>
                                    resolve({ count: state.outboundCount, error: state.countError }),
                            };
                            return chain;
                        },
                        // success: .insert().select().single(); failure-log: await .insert()
                        insert() {
                            return {
                                then: (resolve: (v: unknown) => void) =>
                                    resolve({ error: state.insertError }),
                                select: () => ({
                                    single: () =>
                                        Promise.resolve({ data: state.insertData, error: state.insertError }),
                                }),
                            };
                        },
                    };
                }
                if (table === 'contacts') {
                    return {
                        select: () => ({
                            eq: () => ({
                                maybeSingle: () =>
                                    Promise.resolve({ data: state.contact, error: state.contactError }),
                            }),
                        }),
                    };
                }
                // activities (och övrigt): await .insert()
                return { insert: () => Promise.resolve({ error: null }) };
            },
        },
    };
});

// Importeras EFTER mockarna registrerats.
import { executeCommsEmail } from './comms';
import { config } from '../config';

const validTask = {
    id: 'task-1',
    input: { contact_id: 'c-1', subject: 'Hej', body: 'Kroppstext' },
};

const contactWithEmail = {
    id: 'c-1',
    name: 'Studio X',
    email: 'info@studiox.se',
    custom: {},
    customer_id: 'cust-1',
};

beforeEach(() => {
    // Återställ till "allt grönt, utskick tillåtna, 0 skickade idag".
    config.OUTBOUND_ENABLED = true;
    config.OUTBOUND_DAILY_LIMIT = 5;
    h.state.outboundCount = 0;
    h.state.countError = null;
    h.state.contact = { ...contactWithEmail };
    h.state.contactError = null;
    h.state.insertData = { id: 'msg-1' };
    h.state.insertError = null;
    h.sendMock.mockReset();
    h.sendMock.mockResolvedValue({ providerMessageId: 'prov-1' });
});

describe('executeCommsEmail — utskicksgrindar', () => {
    it('kill switch: OUTBOUND_ENABLED=false hårdstoppar oavsett godkännande', async () => {
        config.OUTBOUND_ENABLED = false;

        const res = await executeCommsEmail(validTask, 'run-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/avstängda/i);
        // Ingen provider får anropas när grinden är stängd.
        expect(h.sendMock).not.toHaveBeenCalled();
    });

    it('kill switch går före dagsbudgeten (stängt även när budget finns kvar)', async () => {
        config.OUTBOUND_ENABLED = false;
        h.state.outboundCount = 0; // budget finns

        const res = await executeCommsEmail(validTask, 'run-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/avstängda/i);
    });

    it('dagsbudget: blockerar när sentToday >= OUTBOUND_DAILY_LIMIT', async () => {
        h.state.outboundCount = 5; // == limit

        const res = await executeCommsEmail(validTask, 'run-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/budget/i);
        expect(h.sendMock).not.toHaveBeenCalled();
    });

    it('dagsbudget: släpper igenom precis under gränsen', async () => {
        h.state.outboundCount = 4; // < limit (5)

        const res = await executeCommsEmail(validTask, 'run-1');

        expect(res.success).toBe(true);
        expect(h.sendMock).toHaveBeenCalledTimes(1);
    });
});

describe('executeCommsEmail — input- och kontaktvalidering', () => {
    it('kräver contact_id', async () => {
        const res = await executeCommsEmail({ id: 't', input: { subject: 'x', body: 'y' } }, 'run-1');
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/contact_id/i);
        expect(h.sendMock).not.toHaveBeenCalled();
    });

    it('kräver subject och body', async () => {
        const res = await executeCommsEmail({ id: 't', input: { contact_id: 'c-1' } }, 'run-1');
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/subject.*body|body/i);
        expect(h.sendMock).not.toHaveBeenCalled();
    });

    it('felar när kontakten inte hittas', async () => {
        h.state.contact = null;
        const res = await executeCommsEmail(validTask, 'run-1');
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/hittades inte/i);
        expect(h.sendMock).not.toHaveBeenCalled();
    });

    it('felar när kontakten saknar e-postadress', async () => {
        h.state.contact = { id: 'c-1', name: 'Studio X', email: null, custom: {}, customer_id: 'cust-1' };
        const res = await executeCommsEmail(validTask, 'run-1');
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/saknar e-post/i);
        expect(h.sendMock).not.toHaveBeenCalled();
    });

    it('faller tillbaka på custom.email när kolumnen email är tom', async () => {
        h.state.contact = {
            id: 'c-1', name: 'Studio X', email: null,
            custom: { email: 'fallback@studiox.se' }, customer_id: 'cust-1',
        };
        const res = await executeCommsEmail(validTask, 'run-1');
        expect(res.success).toBe(true);
        expect(h.sendMock).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'fallback@studiox.se' })
        );
    });
});

describe('executeCommsEmail — lyckat utskick', () => {
    it('skickar, loggar och räknar upp dagsvolymen', async () => {
        h.state.outboundCount = 2;

        const res = await executeCommsEmail(validTask, 'run-1');

        expect(res.success).toBe(true);
        expect(h.sendMock).toHaveBeenCalledTimes(1);
        expect(h.sendMock).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'info@studiox.se', subject: 'Hej', text: 'Kroppstext' })
        );
        expect(res.output).toMatchObject({
            to: 'info@studiox.se',
            provider_message_id: 'prov-1',
            sent_today: 3, // 2 + 1
            daily_limit: 5,
        });
    });

    it('returnerar fel om providern kastar (och skickar inte vidare success)', async () => {
        h.sendMock.mockRejectedValue(new Error('Resend nere'));

        const res = await executeCommsEmail(validTask, 'run-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Resend nere/);
    });
});
