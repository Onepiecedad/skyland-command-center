/**
 * Integrations-hälsa (GHL-härledd SCC-37) — GHL:s näst vanligaste driftsvikt är att
 * integrationer dör TYST av token-bortfall. SCC ska istället upptäcka det innan något
 * går sönder: proba varje konfigurerad integration, rapportera status, och (valfritt)
 * logga en synlig varning när något är nere.
 *
 * Varje check är best-effort med timeout och kastar aldrig uppåt.
 */

import { supabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';

export type HealthStatus = 'up' | 'down' | 'auth_failed' | 'not_configured';

export interface IntegrationHealth {
    name: string;
    configured: boolean;
    status: HealthStatus;
    http_status?: number;
    detail?: string;
    checked_at: string;
}

async function timedFetch(url: string, opts: RequestInit, ms = 5000): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}

function mk(name: string, configured: boolean, status: HealthStatus, http?: number, detail?: string): IntegrationHealth {
    return { name, configured, status, http_status: http, detail, checked_at: new Date().toISOString() };
}

// --- enskilda checks ---

async function checkSupabase(): Promise<IntegrationHealth> {
    try {
        const { error } = await supabase.from('contacts').select('id', { count: 'exact', head: true }).limit(1);
        return error ? mk('supabase', true, 'down', undefined, error.message) : mk('supabase', true, 'up');
    } catch (err) {
        return mk('supabase', true, 'down', undefined, err instanceof Error ? err.message : 'okänt fel');
    }
}

async function checkResend(): Promise<IntegrationHealth> {
    if (!config.RESEND_API_KEY) return mk('resend', false, 'not_configured');
    try {
        const res = await timedFetch('https://api.resend.com/domains', {
            headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` },
        });
        if (res.status === 401 || res.status === 403) return mk('resend', true, 'auth_failed', res.status);
        return res.ok ? mk('resend', true, 'up', res.status) : mk('resend', true, 'down', res.status);
    } catch (err) {
        return mk('resend', true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

async function checkCalcom(): Promise<IntegrationHealth> {
    if (!config.CALCOM_API_KEY) return mk('calcom', false, 'not_configured');
    try {
        // v2 /me — v1 är avvecklat (HTTP 410 sedan 2026). Samma auth-mönster som bokningsflödet (voice.ts).
        const res = await timedFetch(`${config.CALCOM_API_BASE_URL}/me`, {
            headers: {
                Authorization: `Bearer ${config.CALCOM_API_KEY}`,
                'cal-api-version': '2024-08-13',
            },
        });
        if (res.status === 401 || res.status === 403) return mk('calcom', true, 'auth_failed', res.status);
        return res.ok ? mk('calcom', true, 'up', res.status) : mk('calcom', true, 'down', res.status);
    } catch (err) {
        return mk('calcom', true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

async function check46elks(): Promise<IntegrationHealth> {
    if (!config.ELKS_API_USERNAME || !config.ELKS_API_PASSWORD) return mk('46elks', false, 'not_configured');
    try {
        const auth = Buffer.from(`${config.ELKS_API_USERNAME}:${config.ELKS_API_PASSWORD}`).toString('base64');
        const res = await timedFetch('https://api.46elks.com/a1/me', { headers: { Authorization: `Basic ${auth}` } });
        if (res.status === 401 || res.status === 403) return mk('46elks', true, 'auth_failed', res.status);
        return res.ok ? mk('46elks', true, 'up', res.status) : mk('46elks', true, 'down', res.status);
    } catch (err) {
        return mk('46elks', true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

async function checkOpenRouter(): Promise<IntegrationHealth> {
    if (!config.OPENROUTER_API_KEY) return mk('openrouter', false, 'not_configured');
    try {
        const res = await timedFetch('https://openrouter.ai/api/v1/auth/key', {
            headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` },
        });
        if (res.status === 401 || res.status === 403) return mk('openrouter', true, 'auth_failed', res.status);
        return res.ok ? mk('openrouter', true, 'up', res.status) : mk('openrouter', true, 'down', res.status);
    } catch (err) {
        return mk('openrouter', true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

/**
 * Sajten skylandai.se (plan 2.1b, ersätter n8n-checkarna sedan n8n avvecklades
 * 2026-08-30). Kedjan som måste hålla för att en besökare ska kunna prata med
 * Alex och boka: Netlify svarar → lang.js pekar på RÄTT ElevenLabs-agenter →
 * SCC:s agent-tools svarar med token över den publika adressen → agenterna
 * finns i det ElevenLabs-konto vars nyckel ligger i Render.
 * Agent-id:n är kanon i docs/SITE_FLOWS.md och backend/scripts/create_site_agent.py.
 */
export const SITE_URL = 'https://skylandai.se';
export const SITE_AGENT_IDS: Record<'sv' | 'en', string> = {
    sv: 'agent_8301m19fffmqfcv96zgryg5ey3k5',
    en: 'agent_4501m19h1g8zfq7v6k6hqh642p32',
};

async function checkSiteUp(): Promise<IntegrationHealth> {
    const name = 'site:skylandai.se';
    try {
        const res = await timedFetch(`${SITE_URL}/`, { method: 'GET', redirect: 'follow' });
        return res.ok ? mk(name, true, 'up', res.status) : mk(name, true, 'down', res.status, 'sajten svarar inte 2xx');
    } catch (err) {
        return mk(name, true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

/** lang.js måste innehålla båda agent-id:na — annars ringer sajten en agent
 *  som inte finns (eller ligger i ett konto vi inte når, se DRIFT.md). */
async function checkSiteLangJs(): Promise<IntegrationHealth> {
    const name = 'site:lang.js';
    try {
        const res = await timedFetch(`${SITE_URL}/lang.js`, { method: 'GET' });
        if (!res.ok) return mk(name, true, 'down', res.status, 'lang.js svarar inte');
        const body = await res.text().catch(() => '');
        const missing = (Object.keys(SITE_AGENT_IDS) as ('sv' | 'en')[]).filter(k => !body.includes(SITE_AGENT_IDS[k]));
        if (missing.length) return mk(name, true, 'down', res.status, `lang.js saknar agent-id för: ${missing.join(', ')}`);
        return mk(name, true, 'up', res.status, 'sv + en pekar på rätt agenter');
    } catch (err) {
        return mk(name, true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

/** Självtest över den PUBLIKA adressen: samma väg ElevenLabs-agenten tar, med
 *  samma token-fallback som tokenAuth i siteWebhooks.ts. Fångar DNS/TLS/proxy-
 *  fel och token-glapp mellan Render och agentens verktygskonfig. */
async function checkSiteAgentTools(): Promise<IntegrationHealth> {
    const name = 'site:agent-tools';
    const token = process.env.SITE_RAG_KEY || process.env.LEADS_INTAKE_TOKEN || config.SCC_API_TOKEN;
    if (!token) return mk(name, false, 'not_configured');
    const base = (config.SCC_PUBLIC_BASE_URL || 'https://scc.skylandai.se').replace(/\/$/, '');
    try {
        const res = await timedFetch(`${base}/api/v1/webhooks/site/agent-tools/get_current_time`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Skyland-Key': token },
            body: '{}',
        });
        if (res.status === 401 || res.status === 403) return mk(name, true, 'auth_failed', res.status, 'token avvisad');
        if (!res.ok) return mk(name, true, 'down', res.status);
        const json = await res.json().catch(() => ({})) as { now_iso?: string };
        return json.now_iso
            ? mk(name, true, 'up', res.status, `get_current_time svarar via ${base}`)
            : mk(name, true, 'down', res.status, 'svar utan now_iso');
    } catch (err) {
        return mk(name, true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

/** Båda sajtagenterna ska finnas i kontot vars nyckel Render har. Lärdom 30 aug:
 *  de gamla agenterna låg i ett konto Joakim inte når. */
async function checkSiteAgents(): Promise<IntegrationHealth> {
    const name = 'elevenlabs:site-agents';
    const apiKey = process.env.SITE_ELEVENLABS_API_KEY || config.ELEVENLABS_API_KEY;
    if (!apiKey) return mk(name, false, 'not_configured');
    try {
        const problems: string[] = [];
        for (const [lang, id] of Object.entries(SITE_AGENT_IDS)) {
            const res = await timedFetch(`https://api.elevenlabs.io/v1/convai/agents/${id}`, { headers: { 'xi-api-key': apiKey } });
            if (res.status === 401 || res.status === 403) return mk(name, true, 'auth_failed', res.status);
            if (!res.ok) problems.push(`${lang} (${id}) → HTTP ${res.status}`);
        }
        if (problems.length) return mk(name, true, 'down', undefined, `agent saknas i kontot: ${problems.join('; ')}`);
        return mk(name, true, 'up', 200, 'sv + en finns i SCC:s ElevenLabs-konto');
    } catch (err) {
        return mk(name, true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

/**
 * ElevenLabs-verktygens URL:er — ngrok-läxan (2026-07-19): verktygen pekade på
 * en död tunnel i fem dagar utan ett enda larm. Verifierar att varje webhook-
 * verktyg agenten har pekar på SCC:s publika adress.
 */
async function checkElevenLabsTools(): Promise<IntegrationHealth> {
    const name = 'elevenlabs-tools';
    if (!config.ELEVENLABS_API_KEY || !config.ELEVENLABS_AGENT_ID) return mk(name, false, 'not_configured');
    const expectedHost = 'scc.skylandai.se';
    try {
        const agentRes = await timedFetch(
            `https://api.elevenlabs.io/v1/convai/agents/${config.ELEVENLABS_AGENT_ID}`,
            { headers: { 'xi-api-key': config.ELEVENLABS_API_KEY } }
        );
        if (agentRes.status === 401 || agentRes.status === 403) return mk(name, true, 'auth_failed', agentRes.status);
        if (!agentRes.ok) return mk(name, true, 'down', agentRes.status);
        const agent = await agentRes.json() as { conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } };
        const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
        const wrong: string[] = [];
        for (const id of toolIds) {
            const toolRes = await timedFetch(`https://api.elevenlabs.io/v1/convai/tools/${id}`, {
                headers: { 'xi-api-key': config.ELEVENLABS_API_KEY },
            });
            if (!toolRes.ok) continue;
            const tool = await toolRes.json() as { tool_config?: { name?: string; api_schema?: { url?: string } } };
            const url = tool.tool_config?.api_schema?.url ?? '';
            if (url && !url.includes(expectedHost)) wrong.push(`${tool.tool_config?.name ?? id} → ${url}`);
        }
        if (wrong.length) return mk(name, true, 'down', undefined, `verktyg pekar på FEL adress: ${wrong.join('; ')}`);
        return mk(name, true, 'up', 200, `${toolIds.length} verktyg verifierade mot ${expectedHost}`);
    } catch (err) {
        return mk(name, true, 'down', undefined, err instanceof Error ? err.message : 'nätfel');
    }
}

export async function checkAll(): Promise<IntegrationHealth[]> {
    return Promise.all([
        checkSupabase(), checkResend(), checkCalcom(), check46elks(), checkOpenRouter(),
        checkElevenLabsTools(),
        checkSiteUp(), checkSiteLangJs(), checkSiteAgentTools(), checkSiteAgents(),
    ]);
}

/** Periodisk vakt: proba allt, logga en synlig varning för det som är nere/auth-fel. */
export async function runHealthCheckAndAlert(): Promise<void> {
    try {
        const results = await checkAll();
        const bad = results.filter(r => r.status === 'down' || r.status === 'auth_failed');
        for (const r of bad) {
            await supabase.from('activities').insert({
                customer_id: null, agent: 'system:health', event_type: 'system',
                action: 'integration.health.degraded',
                severity: r.status === 'auth_failed' ? 'error' : 'warn',
                details: { integration: r.name, status: r.status, http_status: r.http_status, detail: r.detail },
            });
        }
        if (bad.length) logger.warn('integrationHealth', `${bad.length} integration(er) nere: ${bad.map(b => b.name).join(', ')}`);
    } catch (err) {
        logger.error('integrationHealth', `vakt-fel: ${err instanceof Error ? err.message : err}`);
    }
}

let timer: NodeJS.Timeout | null = null;
export function startHealthMonitor(intervalMs = 600000): void {
    if (timer) return;
    logger.info('integrationHealth', `vakt startad, koll var ${Math.round(intervalMs / 60000)} min`);
    timer = setInterval(() => { void runHealthCheckAndAlert(); }, intervalMs);
}
