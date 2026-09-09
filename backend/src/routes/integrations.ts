/**
 * Integrations-hälsa API (SCC-37) — operatörsvy för System-fliken.
 * GET /api/v1/integrations/health → status per integration (up/down/auth_failed/not_configured).
 */

import { Router, Request, Response } from 'express';
import { checkAll } from '../services/integrationHealth';
import { config } from '../config';
import { supabase } from '../services/supabase';

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
            // Per hink (8 sep). Serialiserad så drift_check kan jämföra strängen rakt av.
            OUTBOUND_DAILY_LIMITS: JSON.stringify(config.OUTBOUND_DAILY_LIMITS ?? {}),
            TRANSACTIONAL_OUTBOUND_ENABLED: String(config.TRANSACTIONAL_OUTBOUND_ENABLED),
            INTEGRATION_HEALTH_ENABLED: String(config.INTEGRATION_HEALTH_ENABLED),
            EMAIL_FROM: config.EMAIL_FROM ?? null,
            EMAIL_REPLY_TO: config.EMAIL_REPLY_TO ?? null,
            EMAIL_FORWARD_TO: config.EMAIL_FORWARD_TO ?? null,
            WHATSAPP_OUTBOUND_ENABLED: String(config.WHATSAPP_OUTBOUND_ENABLED),
            WHATSAPP_TENANT_SLUG: config.WHATSAPP_TENANT_SLUG,
            WHATSAPP_GRAPH_VERSION: config.WHATSAPP_GRAPH_VERSION,
            // Granskning 6 sep: de här stod i DRIFT.md men exponerades inte, så
            // drift_check kunde inte kontrollera dem alls.
            OUTREACH_WINDOW_ENABLED: String(config.OUTREACH_WINDOW_ENABLED),
            OUTREACH_JITTER_MINUTES: String(config.OUTREACH_JITTER_MINUTES),
            POLLER_WATCHDOG_ENABLED: String(config.POLLER_WATCHDOG_ENABLED),
            POLLER_STALE_MINUTES: String(config.POLLER_STALE_MINUTES),
            POLLER_WATCHDOG_INTERVAL_MS: String(config.POLLER_WATCHDOG_INTERVAL_MS),
            REPLY_CLASSIFIER_ENABLED: String(config.REPLY_CLASSIFIER_ENABLED),
            REPLY_CLASSIFIER_MIN_CONFIDENCE: String(config.REPLY_CLASSIFIER_MIN_CONFIDENCE),
            DAILY_DIGEST_ENABLED: String(config.DAILY_DIGEST_ENABLED),
            DAILY_DIGEST_HOUR: String(config.DAILY_DIGEST_HOUR),
            DAILY_DIGEST_INTERVAL_MS: String(config.DAILY_DIGEST_INTERVAL_MS),
        },
        secrets: {
            EMAIL_INBOUND_TOKEN: isSet(config.EMAIL_INBOUND_TOKEN),
            WHATSAPP_VERIFY_TOKEN: isSet(config.WHATSAPP_VERIFY_TOKEN),
            WHATSAPP_APP_SECRET: isSet(config.WHATSAPP_APP_SECRET),
            WHATSAPP_ACCESS_TOKEN: isSet(config.WHATSAPP_ACCESS_TOKEN),
            WHATSAPP_PHONE_NUMBER_ID: isSet(config.WHATSAPP_PHONE_NUMBER_ID),
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

// ---------------------------------------------------------------------------
// GET /openrouter/credits — kvarvarande saldo på OpenRouter + vad Alex
// förbrukat enligt costs-tabellen (24 h / 7 d). Saldot cachas 5 min så
// systemvyn kan polla utan att slå på OpenRouter varje gång.
// ---------------------------------------------------------------------------
interface CreditsSnapshot {
    remaining_usd: number | null;
    total_credits_usd: number | null;
    total_usage_usd: number | null;
    spent_24h_usd: number;
    spent_7d_usd: number;
    error?: string;
    fetched_at: string;
}
let creditsCache: { at: number; value: CreditsSnapshot } | null = null;
const CREDITS_TTL_MS = 5 * 60 * 1000;

export async function openRouterCredits(force = false): Promise<CreditsSnapshot> {
    if (!force && creditsCache && Date.now() - creditsCache.at < CREDITS_TTL_MS) return creditsCache.value;

    let remaining: number | null = null, total: number | null = null, usage: number | null = null, error: string | undefined;
    if (!config.OPENROUTER_API_KEY) {
        error = 'OPENROUTER_API_KEY saknas';
    } else {
        try {
            const r = await fetch('https://openrouter.ai/api/v1/credits', {
                headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` },
                signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) {
                error = `OpenRouter ${r.status}`;
            } else {
                const j = await r.json() as { data?: { total_credits?: number; total_usage?: number } };
                total = Number(j.data?.total_credits ?? NaN);
                usage = Number(j.data?.total_usage ?? NaN);
                if (Number.isFinite(total) && Number.isFinite(usage)) remaining = Math.round((total - usage) * 100) / 100;
                else error = 'oväntat svar från OpenRouter';
            }
        } catch (e) {
            error = e instanceof Error ? e.message : 'nätfel';
        }
    }

    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const since24 = new Date(Date.now() - 86_400_000).toISOString();
    const { data: rows } = await supabase.from('costs').select('cost_usd, created_at').gte('created_at', since7).limit(5000);
    let s24 = 0, s7 = 0;
    for (const row of rows ?? []) {
        const c = Number(row.cost_usd) || 0;
        s7 += c;
        if (row.created_at >= since24) s24 += c;
    }

    const value: CreditsSnapshot = {
        remaining_usd: remaining,
        total_credits_usd: Number.isFinite(total ?? NaN) ? total : null,
        total_usage_usd: Number.isFinite(usage ?? NaN) ? usage : null,
        spent_24h_usd: Math.round(s24 * 1000) / 1000,
        spent_7d_usd: Math.round(s7 * 1000) / 1000,
        ...(error ? { error } : {}),
        fetched_at: new Date().toISOString(),
    };
    creditsCache = { at: Date.now(), value };
    return value;
}

router.get('/openrouter/credits', async (req: Request, res: Response) => {
    res.json(await openRouterCredits(req.query.force === '1'));
});

export default router;
