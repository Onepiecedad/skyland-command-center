/**
 * gatewayDelegate — server-Alex lämnar över ett uppdrag till gateway-Alex på VPS:en.
 *
 * Varför: förmågorna är delade. Panelens Alex (services/alexBrain) äger CRM:et
 * och skärmen; skillsen — research, prospektering, inkorg, annonser, filer —
 * bor hos gatewayen och nåddes tidigare bara från WhatsApp. Den här modulen är
 * bryggan, och gör panelens Alex till hela Alex.
 *
 * Mönstret är detsamma som röstvägen använder sedan tidigare (routes/voice.ts):
 * varje uppdrag får en EGEN sessionsnyckel så att två uppdrag aldrig köar bakom
 * varandra, och svaret läses ur den sessionens historik. Skillnaden är att det
 * här är återanvändbart och att långa körningar får ett efterspel: när svaret
 * väl kommer skickas det till skärmen i stället för att tappas bort.
 */

import { config } from '../config';

const POLL_INTERVAL_MS = 2500;

export interface DelegateHandle {
    /** Historiknyckeln uppdraget svarar i. Används för att hämta svaret senare. */
    historyKey: string;
}

export interface DelegateResult {
    status: 'answered' | 'running' | 'unavailable';
    answer?: string;
    historyKey?: string;
    error?: string;
}

/** Läser en gateway-sessions historik: antal assistentsvar + det senaste. */
export async function readGatewayHistory(historyKey: string): Promise<{ count: number; lastText: string }> {
    const token = config.CLAWDBOT_GATEWAY_TOKEN;
    if (!token) return { count: -1, lastText: '' };
    try {
        const r = await fetch(`${config.CLAWDBOT_GATEWAY_URL}/tools/invoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tool: 'sessions_history', args: { sessionKey: historyKey, limit: 20 }, sessionKey: 'main' }),
            signal: AbortSignal.timeout(15_000),
        });
        const data = await r.json() as { result?: { content?: { text?: string }[] } };
        const parsed = JSON.parse(data.result?.content?.[0]?.text || '{}');
        const msgs: { role: string; content: unknown }[] = parsed.messages || [];
        const assistants = msgs.filter(m => m.role === 'assistant');
        const last = assistants[assistants.length - 1];
        let text = '';
        if (last) {
            text = typeof last.content === 'string'
                ? last.content
                : (last.content as { type?: string; text?: string }[])
                    .filter(c => c?.type === 'text' && c.text)
                    .map(c => c.text)
                    .join(' ');
        }
        return { count: assistants.length, lastText: text };
    } catch {
        return { count: -1, lastText: '' };
    }
}

/** Väntar på sessionens första/nästa assistentsvar. Tom sträng = hann inte. */
export async function pollGatewayAnswer(historyKey: string, baseline: number, maxWaitMs: number): Promise<string> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const now = await readGatewayHistory(historyKey);
        if (now.count > baseline && now.lastText) return now.lastText;
    }
    return '';
}

/** Skickar uppdraget till gateway-Alex. Returnerar historiknyckeln, eller null om gatewayen inte nås. */
export async function dispatchToGateway(message: string, label = 'SCC-panelen'): Promise<DelegateHandle | null> {
    const hookToken = config.OPENCLAW_HOOK_TOKEN || config.CLAWDBOT_GATEWAY_TOKEN;
    if (!hookToken) return null;
    const sessionKey = `hook:scc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    try {
        const resp = await fetch(`${config.CLAWDBOT_GATEWAY_URL}/hooks/agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hookToken}` },
            body: JSON.stringify({
                message,
                name: label,
                wakeMode: 'now',
                sessionKey,
                agentId: 'main',
                deliver: false,
                // Uppdraget kommer från Joakim själv via panelen — samma förtroende
                // som WhatsApp. Utan flaggan paketeras det som "extern otillförlitlig
                // källa" och modellen vägrar ibland att använda sina verktyg.
                allowUnsafeExternalContent: true,
            }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!resp.ok) {
            console.error('[delegate] hook dispatch failed:', resp.status, (await resp.text()).slice(0, 200));
            return null;
        }
        return { historyKey: `agent:main:${sessionKey}` };
    } catch (err) {
        console.error('[delegate] hook dispatch error:', err instanceof Error ? err.message : err);
        return null;
    }
}
