/**
 * Neka-som-default-grinden. Den skyddar inget idag (alla autentiserade blir
 * operatör) men måste vara på plats INNAN en kundinloggning finns, annars
 * öppnar den inloggningen 50-något rutter som aldrig granskats för det.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireOperator, isOperator } from './principal';

function res() {
    const r: Record<string, unknown> = {};
    r.status = vi.fn(() => r);
    r.json = vi.fn(() => r);
    return r as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('requireOperator', () => {
    it('släpper igenom operatören', () => {
        const next = vi.fn();
        const r = res();
        requireOperator({ principal: { kind: 'operator', source: 'token' } } as Request, r, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(r.status).not.toHaveBeenCalled();
    });

    it('nekar en kundprincipal med 403', () => {
        const next = vi.fn();
        const r = res();
        requireOperator({ principal: { kind: 'customer', customerId: 'c-1' } } as Request, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'operator_only' }));
    });

    it('nekar ett anrop helt utan principal', () => {
        const next = vi.fn();
        const r = res();
        requireOperator({} as Request, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });
});

describe('isOperator', () => {
    it('är sann bara för operatören', () => {
        expect(isOperator({ kind: 'operator', source: 'session' })).toBe(true);
        expect(isOperator({ kind: 'customer', customerId: 'c-1' })).toBe(false);
        expect(isOperator(undefined)).toBe(false);
    });
});
