import { Router, Request, Response } from 'express';
import { z } from 'zod';

const router = Router();

// ============================================================================
// Openwork Webhook Handler
// ============================================================================

// Webhook event types from Openwork
const WebhookEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('job.new'),
    job_id: z.string(),
    title: z.string(),
    description: z.string(),
    reward: z.number(),
    tags: z.array(z.string()),
    type: z.string().optional(),
  }),
  z.object({
    event: z.literal('job.matched'),
    job_id: z.string(),
    title: z.string(),
    match_score: z.number(),
    matched_tags: z.array(z.string()),
  }),
  z.object({
    event: z.literal('submission.feedback'),
    job_id: z.string(),
    submission_id: z.string(),
    score: z.number(),
    comment: z.string(),
  }),
  z.object({
    event: z.literal('submission.selected'),
    job_id: z.string(),
    submission_id: z.string(),
    reward: z.number(),
  }),
  z.object({
    event: z.literal('submission.rejected'),
    job_id: z.string(),
    submission_id: z.string(),
    reason: z.string().optional(),
  }),
]);

type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// Store recent webhook events for display
const recentEvents: Array<{
  id: string;
  event: WebhookEvent;
  received_at: string;
}> = [];

// ============================================================================
// POST /webhook/openwork — Receive Openwork webhook events
// ============================================================================
router.post('/openwork', async (req: Request, res: Response) => {
  try {
    const parsed = WebhookEventSchema.safeParse(req.body);

    if (!parsed.success) {
      console.error('[Openwork Webhook] Invalid event:', parsed.error.issues);
      return res.status(400).json({
        error: 'Invalid webhook event',
        details: parsed.error.issues,
      });
    }

    const event = parsed.data;
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Store event
    recentEvents.unshift({
      id: eventId,
      event,
      received_at: new Date().toISOString(),
    });

    // Keep only last 50 events
    if (recentEvents.length > 50) {
      recentEvents.pop();
    }

    console.log(`[Openwork Webhook] Received: ${event.event}`, {
      jobId: 'job_id' in event ? event.job_id : undefined,
    });

    // Handle different event types
    switch (event.event) {
      case 'job.new':
        console.log(`[Openwork] New job posted: "${event.title}" (${event.reward} $OPENWORK)`);
        break;

      case 'job.matched':
        console.log(`[Openwork] Job matched: "${event.title}" (score: ${event.match_score})`);
        // TODO: Notify Alex via gateway or store for next heartbeat
        break;

      case 'submission.feedback':
        console.log(`[Openwork] Feedback received: score ${event.score}/5 - "${event.comment}"`);
        break;

      case 'submission.selected':
        console.log(`[Openwork] 🎉 Submission selected! Earned ${event.reward} $OPENWORK`);
        break;

      case 'submission.rejected':
        console.log(`[Openwork] Submission rejected: ${event.reason || 'No reason given'}`);
        break;
    }

    return res.json({
      received: true,
      event_id: eventId,
      event: event.event,
    });
  } catch (err) {
    console.error('[Openwork Webhook] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /webhook/events — List recent webhook events
// ============================================================================
router.get('/events', (_req: Request, res: Response) => {
  return res.json({
    events: recentEvents,
    count: recentEvents.length,
  });
});

// ============================================================================
// GET /webhook/status — Webhook status
// ============================================================================
router.get('/status', (_req: Request, res: Response) => {
  return res.json({
    webhook_url: '/api/v1/webhook/openwork',
    events_received: recentEvents.length,
    last_event: recentEvents[0] || null,
  });
});

export default router;
