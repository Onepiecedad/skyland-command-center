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
    OPENCLAW_WORKSPACE: z.string().optional(),
    ARCHIVE_PATH: z.string().optional(),
    SKILLS_DIR: z.string().optional(),

    // --- ElevenLabs Voice ---
    ELEVENLABS_API_KEY: z.string().optional(),
    ELEVENLABS_AGENT_ID: z.string().optional(),

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
