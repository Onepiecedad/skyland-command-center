/**
 * SCC-45 — tester för bokningsspegeln (mirrorBooking).
 *
 * Cal.com äger bokningen, SCC speglar den: matcha kontakt på attendee-mejl,
 * upserta bookings-raden med rätt status, och trigga sekvenshändelsen. Testerna
 * täcker validering (saknat external_id), status-mappning, kontakt-matchning vs
 * omatchad, och upsert-fel. sequenceEvents och supabase mockade.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        contact: null as Record<string, unknown> | null,
        upsert: { data: { id: 'bk-1' } as Record<string, unknown> | null, error: null as unknown },
        upsertPayload: null as Record<string, unknown> | null,
    };
    const seq = { created: vi.fn(async () => undefined), cancelled: vi.fn(async () => undefined), noShow: vi.fn(async () => undefined) };
    return { state, seq };
});

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./sequenceEvents', () => ({
    onBookingCreated: h.seq.created,
    onBookingCancelled: h.seq.cancelled,
    onBookingNoShow: h.seq.noShow,
}));

vi.mock('./supabase', () => ({
    supabase: {
        from(table: string) {
            if (table === 'contacts') {
                return { select: () => ({ or: () => ({ limit: () => Promise.resolve({ data: h.state.contact ? [h.state.contact] : [], error: null }) }) }) };
            }
            if (table === 'bookings') {
                return {
                    upsert: (payload: Record<string, unknown>) => {
                        h.state.upsertPayload = payload;
                        return { select: () => ({ single: () => Promise.resolve(h.state.upsert) }) };
                    },
                };
            }
            // activities
            return { insert: () => Promise.resolve({ error: null }) };
        },
    },
}));

import { mirrorBooking } from './bookings';

beforeEach(() => {
    h.state.contact = { id: 'c-1', customer_id: 'cust-1' };
    h.state.upsert = { data: { id: 'bk-1' }, error: null };
    h.state.upsertPayload = null;
    h.seq.created.mockClear();
    h.seq.cancelled.mockClear();
    h.seq.noShow.mockClear();
});

describe('mirrorBooking', () => {
    it('utan external_id → ok:false, matched:false (ignoreras)', async () => {
        const res = await mirrorBooking('created', { external_id: '' });
        expect(res).toEqual({ ok: false, matched: false });
    });

    it('matchar kontakt, upsertar med rätt status och triggar created', async () => {
        const res = await mirrorBooking('created', {
            external_id: 'cal-1', attendee_email: 'Anna@X.se', starts_at: '2026-02-01T10:00:00Z',
        });

        expect(res).toMatchObject({ ok: true, booking_id: 'bk-1', contact_id: 'c-1', matched: true });
        expect(h.state.upsertPayload).toMatchObject({ external_id: 'cal-1', status: 'booked', source: 'calcom', contact_id: 'c-1' });
        expect(h.seq.created).toHaveBeenCalledTimes(1);
        expect(h.seq.cancelled).not.toHaveBeenCalled();
    });

    it('mappar cancelled-status och triggar cancelled-händelsen', async () => {
        const res = await mirrorBooking('cancelled', { external_id: 'cal-2', attendee_email: 'a@x.se' });
        expect(res.ok).toBe(true);
        expect(h.state.upsertPayload).toMatchObject({ status: 'cancelled' });
        expect(h.seq.cancelled).toHaveBeenCalledTimes(1);
    });

    it('omatchad kontakt (ingen träff) → matched:false, ingen sekvenshändelse', async () => {
        h.state.contact = null;
        const res = await mirrorBooking('created', { external_id: 'cal-3', attendee_email: 'noone@x.se' });
        expect(res.matched).toBe(false);
        expect(res.contact_id).toBeNull();
        expect(h.seq.created).not.toHaveBeenCalled();
    });

    it('upsert-fel → ok:false', async () => {
        h.state.upsert = { data: null, error: { message: 'upsert kaputt' } };
        const res = await mirrorBooking('created', { external_id: 'cal-4', attendee_email: 'a@x.se' });
        expect(res.ok).toBe(false);
    });
});
