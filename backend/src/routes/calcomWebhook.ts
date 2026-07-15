/**
 * Cal.com-webhook (SCC-45 / SEQ-6) — mottar boknings-events och speglar dem i SCC.
 * Monteras FÖRE global auth. Egen token: CALCOM_WEBHOOK_TOKEN (?token= eller Bearer),
 * fallback SCC_API_TOKEN. TODO: byt till Cal.com HMAC-signaturverifiering när skarp.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../services/logger';
import { mirrorBooking, BookingTrigger, NormalizedBooking } from '../services/bookings';

const router = Router();

function webhookAuth(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.CALCOM_WEBHOOK_TOKEN || config.SCC_API_TOKEN;
    const bearer = (req.headers.authorization || '').split(' ')[1];
    const token = bearer || (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token || token !== expected) { res.status(401).json({ error: 'Ogiltig webhook-token' }); return; }
    next();
}

// Cal.com triggerEvent → intern bokningshändelse
function mapTrigger(ev: string): BookingTrigger | null {
    switch (ev) {
        case 'BOOKING_CREATED':
        case 'BOOKING_REQUESTED': return 'created';
        case 'BOOKING_CANCELLED': return 'cancelled';
        case 'BOOKING_RESCHEDULED': return 'rescheduled';
        case 'BOOKING_NO_SHOW_UPDATED': return 'no_show';
        default: return null;
    }
}

function normalize(payload: Record<string, unknown>): NormalizedBooking {
    const attendees = (payload.attendees as Array<Record<string, unknown>>) ?? [];
    const a = attendees[0] ?? {};
    return {
        external_id: String(payload.uid ?? payload.bookingId ?? ''),
        title: typeof payload.title === 'string' ? payload.title : undefined,
        attendee_email: typeof a.email === 'string' ? a.email : undefined,
        attendee_name: typeof a.name === 'string' ? a.name : undefined,
        starts_at: typeof payload.startTime === 'string' ? payload.startTime : undefined,
        ends_at: typeof payload.endTime === 'string' ? payload.endTime : undefined,
        raw: payload,
    };
}

router.post('/', webhookAuth, async (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const ev = String(body.triggerEvent ?? '');
        const trigger = mapTrigger(ev);
        if (!trigger) return res.status(200).json({ status: 'ignored', event: ev });

        const payload = (body.payload as Record<string, unknown>) ?? {};
        const result = await mirrorBooking(trigger, normalize(payload));
        return res.status(200).json({ status: 'ok', trigger, ...result });
    } catch (err) {
        logger.error('calcomWebhook', `fel: ${err instanceof Error ? err.message : err}`);
        return res.status(200).json({ status: 'error_logged' });  // 200 → ingen retry-storm
    }
});

export default router;
