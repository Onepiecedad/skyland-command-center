/**
 * Centralized Environment Configuration
 * Fas 7.2 — Validates all env vars at startup with Zod
 *
 * Import { config } anywhere to get typed, validated config.
 * Missing required vars → immediate crash with clear message.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Ensure env vars are loaded before validation (handles ES module import ordering)
dotenv.config();

// ============================================================================
// Schema
// ============================================================================

const LLM_PROVIDERS = ['openai', 'deepseek', 'openrouter', 'anthropic'] as const;

const envSchema = z.object({
    // --- Required ---
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    SCC_API_TOKEN: z.string().min(1, 'SCC_API_TOKEN is required'),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('openai'),

    // --- LLM API keys (validated dynamically below) ---
    OPENAI_API_KEY: z.string().optional(),
    DEEPSEEK_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),

    // --- Optional with defaults ---
    PORT: z.coerce.number().default(3001),
    LLM_MODEL: z.string().default('gpt-4o'),
    COST_BUDGET_USD: z.coerce.number().default(150),
    TASK_RUN_REAPER_INTERVAL_SECONDS: z.coerce.number().default(60),
    TASK_RUN_TIMEOUT_MINUTES: z.coerce.number().default(15),

    // --- Optional (no defaults) ---
    BACKEND_URL: z.string().optional(),
    SCC_PUBLIC_BASE_URL: z.string().optional(),
    GIT_REPO_PATH: z.string().optional(),
    N8N_WEBHOOK_URL: z.string().optional(),
    OPENCLAW_HOOK_URL: z.string().optional(),
    OPENCLAW_HOOK_TOKEN: z.string().optional(),
    // 'push' = SCC pushar till OpenClaw-hooken (originaldesign, funkar bara när gatewayn
    // är nåbar från servern). 'pull' = SCC köar claw-körningar och en poller på Macen
    // hämtar dem via GET /claw/pending (krävs på Render — molnet når inte localhost-gatewayn).
    OPENCLAW_DISPATCH_MODE: z.enum(['push', 'pull']).default('push'),
    OPENCLAW_WORKSPACE: z.string().optional(),
    ARCHIVE_PATH: z.string().optional(),
    SKILLS_DIR: z.string().optional(),

    // --- ElevenLabs Voice ---
    ELEVENLABS_API_KEY: z.string().optional(),
    ELEVENLABS_AGENT_ID: z.string().optional(),

    // --- Clawdbot Gateway (voice tool proxy) ---
    CLAWDBOT_GATEWAY_URL: z.string().default('http://127.0.0.1:18789'),
    CLAWDBOT_GATEWAY_TOKEN: z.string().optional(),

    // --- Cal.com (voice agent appointment booking) ---
    CALCOM_API_KEY: z.string().optional(),
    CALCOM_EVENT_TYPE_ID: z.coerce.number().optional(),
    CALCOM_API_BASE_URL: z.string().default('https://api.cal.com/v2'),
    CALCOM_WEBHOOK_TOKEN: z.string().optional(),  // SCC-45: webhook-auth (?token= eller Bearer)

    // --- Operatörslogin (SCC-36) ---
    OPERATOR_PASSWORD: z.string().optional(),
    AUTH_SESSION_SECRET: z.string().optional(),

    // --- Outbound e-post (SCC-30) ---
    EMAIL_PROVIDER: z.enum(['resend']).default('resend'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    EMAIL_REPLY_TO: z.string().optional(),
    OUTBOUND_ENABLED: z
        .string()
        .default('false')
        .transform((v) => v === 'true'),
    OUTBOUND_DAILY_LIMIT: z.coerce.number().default(5),
    // 'shadow' = logga vad som skulle skickats (messages.status='shadow'), skicka inget.
    // Kan bara göra systemet försiktigare: live kräver fortfarande OUTBOUND_ENABLED=true.
    OUTBOUND_MODE: z.enum(['auto', 'shadow']).default('auto'),
    // Transaktionell post (sequences.outbound_policy='transactional', t.ex. bokningspåminnelser)
    // går ut oavsett OUTBOUND_ENABLED/OUTBOUND_MODE. Detta är dess egen kill switch.
    TRANSACTIONAL_OUTBOUND_ENABLED: z
        .string()
        .default('true')
        .transform((v) => v !== 'false'),

    // --- WhatsApp Cloud API (Cold Experience-intaget, 5 sep) ---
    // Webhooken /api/v1/webhooks/whatsapp: GET verifieras med VERIFY_TOKEN, POST
    // signaturkontrolleras med APP_SECRET (X-Hub-Signature-256). Saknas
    // APP_SECRET accepteras bara Bearer LEADS_INTAKE_TOKEN — test/manuell väg.
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_GRAPH_VERSION: z.string().default('v21.0'),
    // Tenanten inkommande hamnar hos när numret inte matchar någon
    // tenants.config.whatsapp_phone_number_id.
    WHATSAPP_TENANT_SLUG: z.string().default('cold-experience'),
    // Egen kill switch. Svar till någon som själv skrivit in är inte outreach
    // och lyder därför inte OUTBOUND_ENABLED/OUTBOUND_MODE/dagsbudgeten.
    WHATSAPP_OUTBOUND_ENABLED: z
        .string()
        .default('true')
        .transform((v) => v !== 'false'),

    // --- Arbetstidsfönster för outreach (plan 2.5) ---
    // Riktiga outreach-utskick går bara vardagar START–END (Europe/Stockholm) och
    // sprids slumpat 0–JITTER minuter så en batch inte fyrar i samma sekund.
    // Gäller INTE transactional (bokningsmejl) och INTE skuggläget (skuggrader
    // ska synas direkt i Skuggvecka).
    OUTREACH_WINDOW_ENABLED: z
        .string()
        .default('true')
        .transform((v) => v !== 'false'),
    OUTREACH_WINDOW_START_HOUR: z.coerce.number().min(0).max(23).default(8),
    OUTREACH_WINDOW_END_HOUR: z.coerce.number().min(1).max(24).default(17),
    OUTREACH_JITTER_MINUTES: z.coerce.number().min(0).default(90),

    // --- Sekvensmotor (SCC-41/42) ---
    SEQUENCE_RUNNER_ENABLED: z
        .string()
        .default('false')
        .transform((v) => v === 'true'),
    SEQUENCE_RUNNER_INTERVAL_MS: z.coerce.number().default(60000),

    // --- Inkommande mejl (SCC-43 / SCC-46 Resend Inbound) ---
    EMAIL_INBOUND_TOKEN: z.string().optional(),
    // Kopia av varje inkommande svar skickas hit (operatörens vanliga inkorg). Tom = ingen kopia.
    EMAIL_FORWARD_TO: z.string().optional(),

    // --- SMS via 46elks (F2 SCC-31 / SEQ-5) ---
    ELKS_API_USERNAME: z.string().optional(),
    ELKS_API_PASSWORD: z.string().optional(),
    SMS_FROM: z.string().optional(),  // virtuellt nummer (E.164) eller alfanumeriskt ID

    // --- Integrations-hälsa (GHL-härledd SCC-37) ---
    INTEGRATION_HEALTH_ENABLED: z
        .string()
        .default('false')
        .transform((v) => v === 'true'),
    INTEGRATION_HEALTH_INTERVAL_MS: z.coerce.number().default(600000),  // 10 min

    // --- Poller-vakt (plan 3.3) ---
    // Alex poller hämtar köade körningar var 15:e sekund. Slutar den — VPS:en nere,
    // gatewayn död, token utgången — står maskinen stilla helt tyst. Vakten mejlar
    // när hjärtslaget uteblivit, och mejlar igen när det kommer tillbaka.
    POLLER_WATCHDOG_ENABLED: z
        .string()
        .default('true')
        .transform((v) => v === 'true'),
    POLLER_STALE_MINUTES: z.coerce.number().default(15),
    POLLER_WATCHDOG_INTERVAL_MS: z.coerce.number().default(60000),  // 1 min

    // --- Svarsklassificering (plan 3.1) ---
    // Under tröskeln sparas klassen men inget kort flyttas och ingen spärras.
    // Ett felklassat "nej" spärrar en kund som ville köpa — det felet får inte
    // gå automatiskt.
    REPLY_CLASSIFIER_ENABLED: z
        .string()
        .default('true')
        .transform((v) => v === 'true'),
    REPLY_CLASSIFIER_MIN_CONFIDENCE: z.coerce.number().default(0.8),

    // --- Daglig digest (plan 3.2) ---
    // Ett mejl på morgonen med gårdagens siffror: utskick, skuggrader som väntar
    // på dom, svar per klass, poller, integrationer och kostnad. Skickas till
    // EMAIL_FORWARD_TO. Vakten mejlar när något är sönder; digesten svarar på
    // frågan "vad gjorde maskinen medan jag sov" även när allt fungerar.
    DAILY_DIGEST_ENABLED: z
        .string()
        .default('true')
        .transform((v) => v === 'true'),
    /** Timme i svensk tid då digesten går. */
    DAILY_DIGEST_HOUR: z.coerce.number().min(0).max(23).default(7),
    /** Hur ofta klockan kollas. Digesten går första kontrollen efter timslaget. */
    DAILY_DIGEST_INTERVAL_MS: z.coerce.number().default(900000),  // 15 min

    // --- Rate limiting ---
    CLAW_MAX_CONCURRENT_PER_CUSTOMER: z.coerce.number().default(3),
    CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER: z.coerce.number().default(20),
    CLAW_MAX_RUNS_PER_HOUR_GLOBAL: z.coerce.number().default(60),
});

// ============================================================================
// Parse & Validate
// ============================================================================

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const lines = Object.entries(errors)
        .map(([key, msgs]) => `  ❌ ${key}: ${msgs?.join(', ')}`)
        .join('\n');
    console.error(`\n🚨 Environment validation failed:\n${lines}\n`);
    process.exit(1);
}

export const config = parsed.data;

// ============================================================================
// Dynamic LLM key validation
// ============================================================================

const LLM_KEY_MAP: Record<string, string | undefined> = {
    openai: config.OPENAI_API_KEY,
    deepseek: config.DEEPSEEK_API_KEY,
    openrouter: config.OPENROUTER_API_KEY,
};

const requiredKey = LLM_KEY_MAP[config.LLM_PROVIDER];
if (!requiredKey && config.LLM_PROVIDER !== 'anthropic') {
    const keyName = `${config.LLM_PROVIDER.toUpperCase()}_API_KEY`;
    console.error(`\n🚨 LLM_PROVIDER="${config.LLM_PROVIDER}" but ${keyName} is not set.\n`);
    process.exit(1);
}

// ============================================================================
// Type export
// ============================================================================

export type AppConfig = z.infer<typeof envSchema>;
