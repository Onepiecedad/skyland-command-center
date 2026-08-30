/**
 * Bokningar (SCC-45-spegeln) — läs-API för kalendern.
 * Cal.com äger bokningen; SCC speglar den i `bookings` via calcomWebhook.
 * GET /api/v1/bookings?from=ISO&to=ISO  (default: 60 dagar bakåt → 120 dagar framåt)
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    const now = Date.now();
    const from = typeof req.query.from === 'string' ? req.query.from : new Date(now - 60 * 86400_000).toISOString();
    const to = typeof req.query.to === 'string' ? req.query.to : new Date(now + 120 * 86400_000).toISOString();
    const { data, error } = await supabase
        .from('bookings')
        .select('id, external_id, title, attendee_email, attendee_name, starts_at, ends_at, status, source, contact_id, customer_id, created_at')
        .gte('starts_at', from).lte('starts_at', to)
        .order('starts_at', { ascending: true }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ bookings: data ?? [] });
});

/**
 * GET /:id/detail — bokningen + kontakt + senaste röstsamtal/formulär för samma person
 * + Cal.com-länkar (Meet, avboka, omboka). Underlag för kortet i kalendern.
 */
router.get('/:id/detail', async (req: Request, res: Response) => {
    const { data: b, error } = await supabase.from('bookings').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!b) return res.status(404).json({ error: 'Bokningen finns inte' });

    const raw = (b.raw || {}) as Record<string, any>;
    const attendee = (raw.attendees?.[0] || {}) as Record<string, any>;
    const uid: string = raw.uid || b.external_id;
    const email: string | null = (b.attendee_email || attendee.email || null)?.toLowerCase() ?? null;

    let contact: Record<string, unknown> | null = null;
    if (b.contact_id) {
        const { data } = await supabase.from('contacts').select('id, name, email, phone, company, website, status, source, custom').eq('id', b.contact_id).maybeSingle();
        contact = data ?? null;
    }

    // Senaste röstsamtal från sajten med samma mejl (extraherad av LLM:en) — ger sammanfattning + bransch + smärtpunkter.
    let voiceCall: Record<string, unknown> | null = null;
    if (email) {
        const { data } = await supabase.from('voice_calls')
            .select('id, session_uuid, summary, duration_seconds, ended_at, extracted_data')
            .filter('extracted_data->>email', 'ilike', email)
            .order('ended_at', { ascending: false }).limit(1);
        voiceCall = data?.[0] ?? null;
    }
    // Senaste formulär (The Void) med samma mejl.
    let form: Record<string, unknown> | null = null;
    if (email) {
        const { data } = await supabase.from('prospects').select('id, name, company, message, score, created_at').ilike('email', email).order('created_at', { ascending: false }).limit(1);
        form = data?.[0] ?? null;
    }

    return res.json({
        booking: {
            id: b.id, external_id: b.external_id, title: b.title, status: b.status, source: b.source,
            starts_at: b.starts_at, ends_at: b.ends_at, created_at: b.created_at,
            attendee_name: b.attendee_name || attendee.name || null, attendee_email: email,
            attendee_phone: attendee.phoneNumber || null, attendee_timezone: attendee.timeZone || null,
            event_title: raw.eventTitle || raw.eventTypeTitle || null,
            description: raw.description || raw.eventDescription || null,
            notes: raw.additionalNotes || raw.responses?.notes?.value || null,
            length_minutes: raw.length ?? null,
            meet_url: raw.metadata?.videoCallUrl || raw.videoCallData?.url || null,
            cancel_url: uid ? `https://app.cal.com/booking/${uid}?cancel=true` : null,
            reschedule_url: uid ? `https://app.cal.com/reschedule/${uid}` : null,
            calcom_url: uid ? `https://app.cal.com/booking/${uid}` : null,
            cancellation_reason: raw.cancellationReason || null,
        },
        contact, voice_call: voiceCall, form,
    });
});

export default router;
