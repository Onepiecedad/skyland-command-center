import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSynligtIntervall } from './useSynligtIntervall';

/** Hela poängen med hooken är att den INTE hämtar när ingen tittar. Går den
 *  regressionen förlorad märks det inte i gränssnittet, bara på fakturan en
 *  månad senare, så den förtjänar ett test. */

function settSynlighet(dold: boolean) {
    Object.defineProperty(document, 'hidden', { value: dold, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('useSynligtIntervall', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('tickar medan fliken syns', () => {
        const fn = vi.fn();
        renderHook(() => useSynligtIntervall(fn, 1000));
        act(() => { vi.advanceTimersByTime(3000); });
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('slutar ticka när fliken göms', () => {
        const fn = vi.fn();
        renderHook(() => useSynligtIntervall(fn, 1000));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(fn).toHaveBeenCalledTimes(2);

        act(() => { settSynlighet(true); });
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(fn).toHaveBeenCalledTimes(2); // en hel minut dold, inget nytt anrop
    });

    it('hämtar direkt när fliken blir synlig igen', () => {
        const fn = vi.fn();
        renderHook(() => useSynligtIntervall(fn, 1000));
        act(() => { settSynlighet(true); });
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(fn).toHaveBeenCalledTimes(0);

        act(() => { settSynlighet(false); });
        expect(fn).toHaveBeenCalledTimes(1); // direkt, utan att vänta på nästa tick
    });

    it('städar upp och tickar inte efter unmount', () => {
        const fn = vi.fn();
        const { unmount } = renderHook(() => useSynligtIntervall(fn, 1000));
        unmount();
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(fn).not.toHaveBeenCalled();
    });

    it('gör ingenting när den är avstängd', () => {
        const fn = vi.fn();
        renderHook(() => useSynligtIntervall(fn, 1000, false));
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(fn).not.toHaveBeenCalled();
    });
});
