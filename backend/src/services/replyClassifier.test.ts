/**
 * Plan 3.1 — enhetstester för svarsklassificeringen.
 *
 * Riskerna här är inte "klassar den rätt" (det avgör modellen) utan de tre som
 * kan göra skada: att låg säkerhet ändå spärrar någon, att ett trasigt LLM-svar
 * kastar uppåt och fäller inmatningen, och att autosvar flyttar kort de inte
 * borde röra.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    alerts: [] as Record<string, unknown>[],
    chatText: '{"intent":"interested","confidence":0.95,"reason":"vill boka"}',
    chatThrows: false,
    suppressions: [] as string[],
    updates: [] as Record<string, unknown>[],
    activities: [] as Record<string, unknown>[],
    conf: 0.8,
    enabled: true,
}));

vi.mock('../llm/adapter', () => ({
    getAdapter: () => ({
        chat: () => {
            if (h.chatThrows) return Promise.reject(new Error('OpenRouter nere'));
            return Promise.resolve({ text: h.chatText });
        },
    }),
}));

vi.mock('../config', () => ({
    config: {
        get REPLY_CLASSIFIER_ENABLED() { return h.enabled; },
        get REPLY_CLASSIFIER_MIN_CONFIDENCE() { return h.conf; },
    },
}));

vi.mock('./outreach', () => ({
    addSuppression: (_k: string, v: string) => { h.suppressions.push(v); return Promise.resolve(); },
}));

vi.mock('./logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

// Plan 3.1: intresserade svar larmar operatören. Larmet mockas — det testas
// för sig i operatorAlert.test.ts; här bevakar vi bara ATT och NÄR det avfyras.
vi.mock('./operatorAlert', () => ({
    alertOperator: (a: Record<string, unknown>) => { h.alerts.push(a); return Promise.resolve({ sent: true }); },
}));

vi.mock('./supabase', () => {
    const chain = (table: string) => ({
        select: () => chain(table),
        eq: () => chain(table),
        limit: () => Promise.resolve({
            data: table === 'opportunities'
                ? [{ id: 'opp-1', stage_id: 'st-0', stages: { name: 'Contacted', pipeline_id: 'pipe-1' } }]
                : [],
        }),
        maybeSingle: () => Promise.resolve({ data: table === 'stages' ? { id: 'st-target' } : null }),
        update: (row: Record<string, unknown>) => { h.updates.push(row); return chain(table); },
        insert: (row: Record<string, unknown>) => { h.activities.push(row); return Promise.resolve({ error: null }); },
    });
    return { supabase: { from: (t: string) => chain(t) } };
});

describe('svarsklassificering', () => {
    let mod: typeof import('./replyClassifier');
    const base = { contactId: 'c-1', customerId: null, fromEmail: 'a@b.se', subject: 'Re: Hej', text: 'Låter intressant!' };

    beforeEach(async () => {
        vi.resetModules();
        h.chatText = '{"intent":"interested","confidence":0.95,"reason":"vill boka"}';
        h.chatThrows = false;
        h.conf = 0.8; h.enabled = true;
        h.suppressions.length = 0; h.updates.length = 0; h.activities.length = 0; h.alerts.length = 0;
        mod = await import('./replyClassifier');
    });

    it('känner igen autosvar på regel utan att fråga modellen', () => {
        expect(mod.classifyByRules('Autosvar: Ur kontoret', 'x')?.intent).toBe('autoreply');
        expect(mod.classifyByRules('Re: hej', 'Jag är på semester och återkommer 15/9')?.intent).toBe('autoreply');
        expect(mod.classifyByRules('Re: hej', 'Låter intressant, ring mig')).toBeNull();
    });

    it('flyttar autosvar ingenstans — de säger inget om intresset', () => {
        expect(mod.targetStageName('autoreply')).toBeNull();
        expect(mod.targetStageName('other')).toBeNull();
        expect(mod.targetStageName('interested')).toBe('Replied');
        expect(mod.targetStageName('question')).toBe('Replied');
        expect(mod.targetStageName('no')).toBe('No Fit');
    });

    it('spärrar vid tydligt nej', async () => {
        h.chatText = '{"intent":"no","confidence":0.93,"reason":"tackar nej"}';
        const r = await mod.classifyAndApply(base);
        expect(r.intent).toBe('no');
        expect(r.suppressed).toBe(true);
        expect(h.suppressions).toContain('a@b.se');
    });

    it('spärrar INTE när säkerheten ligger under tröskeln', async () => {
        h.chatText = '{"intent":"no","confidence":0.55,"reason":"otydligt"}';
        const r = await mod.classifyAndApply(base);
        expect(r.intent).toBe('no');
        expect(r.acted).toBe(false);
        expect(r.suppressed).toBe(false);
        expect(h.suppressions).toHaveLength(0);
        expect(h.activities[0].action).toBe('reply.classified.low_confidence');
    });

    it('kastar aldrig uppåt när modellen är nere', async () => {
        h.chatThrows = true;
        const r = await mod.classifyAndApply(base);
        expect(r.intent).toBeNull();
        expect(r.acted).toBe(false);
    });

    it('kastar aldrig uppåt på obegripligt modellsvar', async () => {
        h.chatText = 'jag vet inte riktigt';
        const r = await mod.classifyAndApply(base);
        expect(r.intent).toBeNull();
    });

    it('avvisar påhittade klasser i stället för att gissa', async () => {
        h.chatText = '{"intent":"kanske","confidence":0.99,"reason":"x"}';
        const r = await mod.classifyAndApply(base);
        expect(r.intent).toBeNull();
    });

    it('går att stänga av helt', async () => {
        h.enabled = false;
        const r = await mod.classifyAndApply(base);
        expect(r.intent).toBeNull();
        expect(h.activities).toHaveLength(0);
    });

    it('flyttar kortet vid intresse', async () => {
        const r = await mod.classifyAndApply(base);
        expect(r.moved).toBe(true);
        expect(h.updates[0]).toHaveProperty('stage_id', 'st-target');
    });
});

describe('operatörslarm vid intresse (plan 3.1)', () => {
    let mod: typeof import('./replyClassifier');
    const base = { contactId: 'c-1', customerId: null, fromEmail: 'amber@x.se', subject: 'Re: Hej', text: 'Ja, berätta mer!' };

    beforeEach(async () => {
        vi.resetModules();
        h.chatText = '{"intent":"interested","confidence":0.95,"reason":"vill veta mer"}';
        h.chatThrows = false; h.conf = 0.8; h.enabled = true;
        h.suppressions.length = 0; h.updates.length = 0; h.activities.length = 0; h.alerts.length = 0;
        mod = await import('./replyClassifier');
    });

    it('larmar med kontaktnamn, klassning och dedupe-nyckel per kontakt', async () => {
        await mod.classifyAndApply({ ...base, contactName: 'Ambers Laserklinik' });
        expect(h.alerts).toHaveLength(1);
        expect(h.alerts[0]).toMatchObject({ kind: 'reply.interested', dedupeKey: 'reply.interested:c-1', contactId: 'c-1' });
        expect(String(h.alerts[0].title)).toContain('Ambers Laserklinik');
        expect(String(h.alerts[0].body)).toContain('Ja, berätta mer!');
    });

    it('utan namn används mejladressen i rubriken', async () => {
        await mod.classifyAndApply(base);
        expect(String(h.alerts[0].title)).toContain('amber@x.se');
    });

    it('larmar inte under konfidenströskeln — då har inget hänt med kortet heller', async () => {
        h.chatText = '{"intent":"interested","confidence":0.5,"reason":"osäkert"}';
        await mod.classifyAndApply(base);
        expect(h.alerts).toHaveLength(0);
    });

    it('larmar inte på nej, autosvar eller fråga', async () => {
        for (const intent of ['no', 'autoreply', 'question', 'other']) {
            h.alerts.length = 0;
            h.chatText = `{"intent":"${intent}","confidence":0.95,"reason":"x"}`;
            await mod.classifyAndApply(base);
            expect(h.alerts, intent).toHaveLength(0);
        }
    });
});
