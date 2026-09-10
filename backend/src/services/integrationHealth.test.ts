import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 10 sep visade panelen "Calcom Nere — This operation was aborted" medan
 * tjänsten svarade 200 på under en sekund vid manuell kontroll. En enda
 * timeout blev ett larm som såg ut som ett avbrott. Testerna nedan beskriver
 * beteendet vi vill ha: ett omförsök vid timeout, inget omförsök vid riktiga
 * fel, och ett felmeddelande skrivet för en människa.
 */

/** Samma logik som timedFetch i integrationHealth.ts. */
async function timedFetch(
    doFetch: (signal: AbortSignal) => Promise<{ ok: boolean }>,
    ms: number,
): Promise<{ ok: boolean }> {
    let sistaFel: unknown = null;
    for (let forsok = 0; forsok < 2; forsok++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try {
            return await doFetch(ctrl.signal);
        } catch (err) {
            sistaFel = err;
            const avbrutet = err instanceof Error
                && (err.name === 'AbortError' || /abort/i.test(err.message));
            if (!avbrutet) throw err;
        } finally {
            clearTimeout(t);
        }
    }
    const fel = new Error(`svarade inte inom ${Math.round(ms / 1000)} s (två försök)`);
    fel.name = 'TimeoutError';
    fel.cause = sistaFel;
    throw fel;
}

function abortFel(): Error {
    const e = new Error('This operation was aborted');
    e.name = 'AbortError';
    return e;
}

describe('integrationHealth: timeouts ska inte måla rött i onödan', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('en engångstimeout följs av ett omförsök som lyckas', async () => {
        let n = 0;
        const res = await timedFetch(async () => {
            n++;
            if (n === 1) throw abortFel();
            return { ok: true };
        }, 5000);
        expect(n).toBe(2);
        expect(res.ok).toBe(true);
    });

    it('två timeouts ger ett fel skrivet för en människa, inte Nodes interna text', async () => {
        await expect(timedFetch(async () => { throw abortFel(); }, 5000))
            .rejects.toThrow('svarade inte inom 5 s (två försök)');
    });

    it('riktiga nätfel görs INTE om — de blir inte bättre av att upprepas', async () => {
        let n = 0;
        await expect(timedFetch(async () => {
            n++;
            throw new Error('getaddrinfo ENOTFOUND api.cal.com');
        }, 5000)).rejects.toThrow(/ENOTFOUND/);
        expect(n).toBe(1);
    });
});
