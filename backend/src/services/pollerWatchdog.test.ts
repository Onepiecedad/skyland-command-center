/**
 * Plan 3.3 — enhetstester för poller-vakten.
 *
 * Riskgrenarna är inte "larmar den när pollern är tyst" utan de tre som avgör om
 * larmet går att lita på: att en omstart inte ger falsklarm, att den inte mejlar
 * varje minut, och att den säger till när allt är bra igen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ sent: [] as { subject: string }[], activities: [] as string[] }));

vi.mock('./supabase', () => ({
    supabase: {
        from: () => ({
            insert: (row: { action: string }) => {
                h.activities.push(row.action);
                return Promise.resolve({ error: null });
            },
        }),
    },
}));

vi.mock('./email', () => ({
    getEmailProvider: () => ({
        send: (m: { subject: string }) => {
            h.sent.push({ subject: m.subject });
            return Promise.resolve({ providerMessageId: 'test' });
        },
    }),
}));

vi.mock('./logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock('../config', () => ({
    config: {
        POLLER_STALE_MINUTES: 15,
        POLLER_WATCHDOG_INTERVAL_MS: 60000,
        EMAIL_FORWARD_TO: 'joakim@skylandai.se',
    },
}));

const MIN = 60_000;

describe('poller-vakten', () => {
    let mod: typeof import('./pollerWatchdog');

    beforeEach(async () => {
        vi.resetModules();
        h.sent.length = 0;
        h.activities.length = 0;
        mod = await import('./pollerWatchdog');
    });

    it('larmar inte direkt efter omstart — minnet är tomt, inte pollern död', async () => {
        mod._resetPollerWatchdog(Date.now());
        const r = await mod.checkPollerHeartbeat();
        expect(r).toBe('waiting');
        expect(h.sent).toHaveLength(0);
    });

    it('larmar när servern varit uppe längre än tröskeln utan ett enda hjärtslag', async () => {
        const started = Date.now() - 20 * MIN;
        mod._resetPollerWatchdog(started);
        const r = await mod.checkPollerHeartbeat();
        expect(r).toBe('alerted');
        expect(h.sent[0].subject).toContain('tystnat');
        expect(h.activities).toContain('poller.heartbeat.stale');
    });

    it('är tyst så länge hjärtslagen kommer', async () => {
        mod._resetPollerWatchdog(Date.now() - 60 * MIN);
        mod.notePollerSeen('alex-1');
        expect(await mod.checkPollerHeartbeat()).toBe('ok');
        expect(h.sent).toHaveLength(0);
    });

    it('mejlar EN gång, inte varje kontroll — annars slutar man läsa larmen', async () => {
        mod._resetPollerWatchdog(Date.now() - 60 * MIN);
        const now = Date.now();
        mod.notePollerSeen('alex-1', now);
        const stale = now + 20 * MIN;
        expect(await mod.checkPollerHeartbeat(stale)).toBe('alerted');
        expect(await mod.checkPollerHeartbeat(stale + MIN)).toBe('alerted');
        expect(await mod.checkPollerHeartbeat(stale + 2 * MIN)).toBe('alerted');
        expect(h.sent).toHaveLength(1);
    });

    it('säger till när pollern är tillbaka', async () => {
        mod._resetPollerWatchdog(Date.now() - 60 * MIN);
        const now = Date.now();
        mod.notePollerSeen('alex-1', now);
        await mod.checkPollerHeartbeat(now + 20 * MIN);
        expect(h.sent).toHaveLength(1);

        mod.notePollerSeen('alex-2', now + 21 * MIN);
        expect(await mod.checkPollerHeartbeat(now + 21 * MIN)).toBe('recovered');
        expect(h.sent).toHaveLength(2);
        expect(h.sent[1].subject).toContain('tillbaka');
        expect(h.activities).toContain('poller.heartbeat.recovered');
    });

    it('kan larma igen efter en återhämtning', async () => {
        mod._resetPollerWatchdog(Date.now() - 60 * MIN);
        const now = Date.now();
        mod.notePollerSeen('alex-1', now);
        await mod.checkPollerHeartbeat(now + 20 * MIN);
        mod.notePollerSeen('alex-2', now + 21 * MIN);
        await mod.checkPollerHeartbeat(now + 21 * MIN);
        expect(await mod.checkPollerHeartbeat(now + 40 * MIN)).toBe('alerted');
        expect(h.sent).toHaveLength(3);
    });

    it('pollerStatus redovisar ålder och worker för statusvyer', () => {
        mod._resetPollerWatchdog(Date.now() - 60 * MIN);
        const now = Date.now();
        mod.notePollerSeen('alex-9', now);
        const s = mod.pollerStatus(now + 90_000);
        expect(s.lastWorker).toBe('alex-9');
        expect(s.secondsSince).toBeGreaterThanOrEqual(90);
        expect(s.stale).toBe(false);
    });
});
