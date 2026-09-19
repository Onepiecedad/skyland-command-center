import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kortCache } from './kortCache';

describe('kortCache', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('hämtar en gång och återanvänder inom fönstret', async () => {
        const hamta = vi.fn().mockResolvedValue('a');
        const cachad = kortCache(30_000, hamta);

        expect(await cachad()).toBe('a');
        expect(await cachad()).toBe('a');
        expect(await cachad()).toBe('a');
        expect(hamta).toHaveBeenCalledTimes(1);
    });

    it('hämtar igen när fönstret gått ut', async () => {
        const hamta = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
        const cachad = kortCache(30_000, hamta);

        expect(await cachad()).toBe('a');
        vi.setSystemTime(Date.now() + 30_001);
        expect(await cachad()).toBe('b');
        expect(hamta).toHaveBeenCalledTimes(2);
    });

    it('slår ihop samtidiga anrop till en hämtning', async () => {
        let losUt: (v: string) => void = () => {};
        const hamta = vi.fn(() => new Promise<string>((res) => { losUt = res; }));
        const cachad = kortCache(30_000, hamta);

        const a = cachad();
        const b = cachad();
        const c = cachad();
        losUt('x');

        expect(await a).toBe('x');
        expect(await b).toBe('x');
        expect(await c).toBe('x');
        expect(hamta).toHaveBeenCalledTimes(1);
    });

    it('cachar inte fel — nästa anrop försöker igen', async () => {
        const hamta = vi.fn()
            .mockRejectedValueOnce(new Error('nere'))
            .mockResolvedValueOnce('a');
        const cachad = kortCache(30_000, hamta);

        await expect(cachad()).rejects.toThrow('nere');
        expect(await cachad()).toBe('a');
        expect(hamta).toHaveBeenCalledTimes(2);
    });
});
