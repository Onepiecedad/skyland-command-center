/**
 * Integrations-hälsa API (SCC-37) — operatörsvy för System-fliken.
 * GET /api/v1/integrations/health → status per integration (up/down/auth_failed/not_configured).
 */

import { Router, Request, Response } from 'express';
import { checkAll } from '../services/integrationHealth';
import { config } from '../config';

const router = Router();

/**
 * GET /api/v1/integrations/flags — driftflaggorna som prod FAKTISKT kör med
 * (stabiliseringsplan fas 1, "en sanning"). Läses av scripts/drift_check.py som
 * jämför mot tabellen i docs/DRIFT.md. Hemligheter exponeras aldrig — bara om
 * de är satta. Kräver vanlig auth (ligger bakom authMiddleware).
 */
const isSet = (v: unknown): 'satt' | 'ej satt' => (v === undefined || v === null || v === '' ? 'ej satt' : 'satt');
router.get('/flags', (_req: Request, res: Response) => {
    res.json({
        checked_at: new Date().toISOString(),
        flags: {
            OUTBOUND_ENABLED: String(config.OUTBOUND_ENABLED),
            OUTBOUND_MODE: config.OUTBOUND_MODE,
            SEQUENCE_RUNNER_ENABLED: String(config.SEQUENCE_RUNNER_ENABLED),
            OUTBOUND_DAILY_LIMIT: String(config.OUTBOUND_DAILY_LIMIT),
            TRANSACTIONAL_OUTBOUND_ENABLED: String(config.TRANSACTIONAL_OUTBOUND_ENABLED),
            INTEGRATION_HEALTH_ENABLED: String(config.INTEGRATION_HEALTH_ENABLED),
            EMAIL_FROM: config.EMAIL_FROM ?? null,
            EMAIL_REPLY_TO: config.EMAIL_REPLY_TO ?? null,
            EMAIL_FORWARD_TO: config.EMAIL_FORWARD_TO ?? null,
            WHATSAPP_OUTBOUND_ENABLED: String(config.WHATSAPP_OUTBOUND_ENABLED),
            WHATSAPP_TENANT_SLUG: config.WHATSAPP_TENANT_SLUG,
            WHATSAPP_PHONE_NUMBER_ID: config.WHATSAPP_PHONE_NUMBER_ID ?? null,
        },
        secrets: {
            EMAIL_INBOUND_TOKEN: isSet(config.EMAIL_INBOUND_TOKEN),
            WHATSAPP_VERIFY_TOKEN: isSet(config.WHATSAPP_VERIFY_TOKEN),
            WHATSAPP_APP_SECRET: isSet(config.WHATSAPP_APP_SECRET),
            WHATSAPP_ACCESS_TOKEN: isSet(config.WHATSAPP_ACCESS_TOKEN),
            LEADS_INTAKE_TOKEN: isSet(process.env.LEADS_INTAKE_TOKEN),
            OPENAI_API_KEY: isSet(config.OPENAI_API_KEY),
            ELEVENLABS_API_KEY: isSet(config.ELEVENLABS_API_KEY),
            ELEVENLABS_AGENT_ID: isSet(config.ELEVENLABS_AGENT_ID),
            CALCOM_API_KEY: isSet(config.CALCOM_API_KEY),
            CALCOM_EVENT_TYPE_ID: isSet(config.CALCOM_EVENT_TYPE_ID),
            CALCOM_WEBHOOK_TOKEN: isSet(config.CALCOM_WEBHOOK_TOKEN),
            RESEND_API_KEY: isSet(config.RESEND_API_KEY),
            SITE_VOICE_WEBHOOK_TOKEN: isSet(process.env.SITE_VOICE_WEBHOOK_TOKEN),
            SITE_RAG_KEY: isSet(process.env.SITE_RAG_KEY),
            SITE_ELEVENLABS_API_KEY: isSet(process.env.SITE_ELEVENLABS_API_KEY),
            EXTRA_CORS_ORIGINS: isSet(process.env.EXTRA_CORS_ORIGINS),
            MM_ORDER_WEBHOOK_TOKEN: isSet(process.env.MM_ORDER_WEBHOOK_TOKEN),
        },
    });
});

router.get('/health', async (_req: Request, res: Response) => {
    const integrations = await checkAll();
    const worst = integrations.some(i => i.status === 'auth_failed' || i.status === 'down');
    res.json({ overall: worst ? 'degraded' : 'healthy', integrations, checked_at: new Date().toISOString() });
});

export default router;
