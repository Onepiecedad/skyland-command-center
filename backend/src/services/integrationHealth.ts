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

export async function checkAll(): Promise<IntegrationHealth[]> {
    return Promise.all([checkSupabase(), checkResend(), checkCalcom(), check46elks(), checkOpenRouter()]);
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
