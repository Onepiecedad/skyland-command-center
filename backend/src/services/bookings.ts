/**
 * Bokningsspegel (SCC-45 / SEQ-6) — Cal.com äger bokningen, SCC speglar den.
 * Tar en normaliserad bokningshändelse, matchar kontakt på attendee-mejl, upsertar
 * bookings-raden och triggar rätt sekvenshändelse (created/cancelled/no_show).
 */

import { supabase } from './supabase';
import { logger } from './logger';
import { onBookingCreated, onBookingCancelled, onBookingNoShow } from './sequenceEvents';

export type BookingTrigger = 'created' | 'cancelled' | 'rescheduled' | 'no_show';

const STATUS: Record<BookingTrigger, string> = {
    created: 'booked', cancelled: 'cancelled', rescheduled: 'rescheduled', no_show: 'no_show',
};

export interface NormalizedBooking {
    external_id: string;
    title?: string;
    attendee_email?: string;
    attendee_name?: string;
    starts_at?: string;
    ends_at?: string;
    raw?: Record<string, unknown>;
}

export async function mirrorBooking(
    trigger: BookingTrigger, b: NormalizedBooking
): Promise<{ ok: boolean; booking_id?: string; contact_id?: string | null; matched: boolean }> {
    if (!b.external_id) { logger.warn('bookings', 'bokning utan external_id, ignorerad'); return { ok: false, matched: false }; }

    // Matcha kontakt på attendee-mejl (email-kolumn eller custom.email)
    let contactId: string | null = null;
    let customerId: string | null = null;
    if (b.attendee_email) {
        const em = b.attendee_email.toLowerCase();
        const { data } = await supabase
            .from('contacts').select('id, customer_id')
            .or(`email.ilike.${em},custom->>email.ilike.${em}`).limit(1);
        const c = (data ?? [])[0] as { id: string; customer_id: string | null } | undefined;
        contactId = c?.id ?? null; customerId = c?.customer_id ?? null;
    }

    const { data: booking, error } = await supabase.from('bookings').upsert({
        external_id: b.external_id,
        contact_id: contactId,
        customer_id: customerId,
        title: b.title ?? null,
        attendee_email: b.attendee_email ?? null,
        attendee_name: b.attendee_name ?? null,
        starts_at: b.starts_at ?? null,
        ends_at: b.ends_at ?? null,
        status: STATUS[trigger],
        source: 'calcom',
        raw: b.raw ?? {},
        updated_at: new Date().toISOString(),
    }, { onConflict: 'external_id' }).select('id').single();

    if (error) { logger.error('bookings', `upsert misslyckades: ${error.message}`); return { ok: false, matched: !!contactId }; }

    await supabase.from('activities').insert({
        customer_id: customerId, agent: 'system:calendar', event_type: 'booking',
        action: `booking.${trigger}`, severity: 'info',
        details: { external_id: b.external_id, contact_id: contactId, title: b.title, starts_at: b.starts_at },
    });

    // Trigga sekvenshändelse om vi hittade en kontakt
    if (contactId) {
        if (trigger === 'created') await onBookingCreated(contactId, null, b.starts_at);
        else if (trigger === 'cancelled') await onBookingCancelled(contactId);
        else if (trigger === 'no_show') await onBookingNoShow(contactId);
    }

    logger.info('bookings', `${trigger} speglad (${b.external_id}) → kontakt ${contactId ?? 'omatchad'}`);
    return { ok: true, booking_id: booking?.id, contact_id: contactId, matched: !!contactId };
}
