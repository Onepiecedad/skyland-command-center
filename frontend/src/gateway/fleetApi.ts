/**
 * Fleet API — Gateway HTTP bridge for agent session data
 *
 * Uses the Clawdbot Gateway's POST /tools/invoke endpoint to call
 * sessions_list and sessions_history tools from the frontend.
 */

const RAW_GATEWAY = (import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:18789')
    .replace('ws://', 'http://')
    .replace('wss://', 'https://');

// In dev mode, use the Vite proxy to avoid CORS; in production, hit the gateway directly
const GATEWAY_HTTP_URL = import.meta.env.DEV ? '/gateway' : RAW_GATEWAY;
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN || '';

// ─── Types ───

export type AgentStatus = 'active' | 'waiting' | 'idle' | 'error';

export interface AgentData {
    id: string;
    name: string;
    role: string;
    status: AgentStatus;
    currentTask: string;
    uptime: string;
    model?: string;
    channel?: string;
    contextTokens?: number;
    totalTokens?: number;
    sessionKey: string;
    updatedAt?: number;
    messages?: MessageEntry[];
}

export interface MessageEntry {
    role: string;
    content: string;
    timestamp?: string;
}

export interface AgentDetail extends AgentData {
    logs: { time: string; message: string }[];
    queue: { task: string; status: string }[];
    transcriptPath?: string;
}

// ─── Helpers ───

/** Detect if a string segment is a UUID */
function isUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Build a friendly display name from the session key + metadata.
 *
 * Key patterns from the gateway:
 *   agent:skyland:main              → "Alex"
 *   agent:skyland:scc:test-ping:*   → "SCC Test Ping"
 *   agent:skyland:scc:e2e-test-001:*→ "SCC E2E Test"
 *   agent:skyland:scc:<uuid>:<uuid> → "SCC Session #3"
 *   agent:skyland:cron:<uuid>       → "Cron Job #1"
 *   agent:skyland:hook:<uuid>       → "Hook Trigger #1"
 */
function formatAgentName(key: string, displayName?: string): string {
    const parts = key.split(':');

    // agent:skyland:main → "Alex"
    if (parts.includes('main')) return 'Alex';

    // Named test sessions: agent:skyland:scc:test-ping:test-run
    const channelType = parts[2]; // 'scc', 'cron', 'hook'
    const identParts = parts.slice(3);

    // Filter out UUID segments, keep named ones
    const namedParts = identParts.filter(p => !isUuid(p));

    if (namedParts.length > 0) {
        const label = namedParts
            .join(' ')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        const prefix = channelType === 'scc' ? 'SCC' : channelType === 'cron' ? 'Cron' : channelType === 'hook' ? 'Hook' : '';
        return prefix ? `${prefix} ${label}` : label;
    }

    // All-UUID segments — use a short hash + channel prefix
    if (channelType === 'scc') {
        // Use displayName (phone number) if available
        if (displayName && displayName !== '' && displayName !== 'unknown') {
            return `SCC Chat (${displayName})`;
        }
        const shortId = identParts[0]?.slice(0, 6) || '?';
        return `SCC Session ${shortId}`;
    }
    if (channelType === 'cron') {
        const shortId = identParts[0]?.slice(0, 6) || '?';
        return `Cron Job ${shortId}`;
    }
    if (channelType === 'hook') {
        const shortId = identParts[0]?.slice(0, 6) || '?';
        return `Hook ${shortId}`;
    }

    // Fallback
    const raw = parts[parts.length - 1];
    return isUuid(raw) ? `Agent ${raw.slice(0, 6)}` : raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function deriveRole(key: string, channel?: string): string {
    const lower = key.toLowerCase();

    // Main Alex agent
    if (lower.includes(':main')) return 'Huvudagent';

    // Channel type from key structure
    if (lower.includes(':cron:')) return 'Schemalagt jobb';
    if (lower.includes(':hook:')) return 'Webhook-trigger';

    // SCC sessions — differentiate by named vs anonymous
    if (lower.includes(':scc:')) {
        if (lower.includes('test') || lower.includes('e2e')) return 'Testning';
        if (channel === 'whatsapp') return 'WhatsApp-session';
        return 'SCC-chatt';
    }

    // Named agent patterns
    if (lower.includes('strategy')) return 'Strategi & Analys';
    if (lower.includes('prospect-finder')) return 'Prospektering';
    if (lower.includes('prospect-researcher')) return 'Research';
    if (lower.includes('li-verifier')) return 'LinkedIn Verifiering';
    if (lower.includes('signal-hook')) return 'Signalövervakning';
    if (lower.includes('dm-writer')) return 'Meddelanden';
    if (lower.includes('content')) return 'Innehållsproduktion';
    if (lower.includes('dev')) return 'Utveckling';
    if (lower.includes('automation')) return 'Automation';
    if (lower.includes('n8n')) return 'Workflow Admin';
    if (lower.includes('qa')) return 'QA & Release';
    if (lower.includes('research-librarian')) return 'Research Bibliotek';
    if (lower.includes('report')) return 'Rapportskrivning';
    if (lower.includes('deep-research')) return 'Djupanalys';
    return 'Sub-Agent';
}

function deriveStatus(session: Record<string, unknown>): AgentStatus {
    const updatedAt = typeof session.updatedAt === 'number' ? session.updatedAt : 0;
    const aborted = session.abortedLastRun === true;
    const ageMs = Date.now() - updatedAt;
    const fiveMinutes = 5 * 60 * 1000;

    if (aborted) return 'error';
    if (ageMs < fiveMinutes) return 'active';
    if (ageMs < 30 * 60 * 1000) return 'waiting';
    return 'idle';
}

function formatUptime(updatedAt?: number): string {
    if (!updatedAt) return '—';
    const diff = Date.now() - updatedAt;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function extractCurrentTask(messages?: unknown[]): string {
    if (!messages || messages.length === 0) return 'Ingen aktiv uppgift';
    // Get last user-role message as task context
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown>;
        if (msg.role === 'user' && typeof msg.content === 'string') {
            const text = msg.content.trim();
            return text.length > 80 ? text.slice(0, 77) + '…' : text;
        }
    }
    return 'Senaste aktivitet saknas';
}

// ─── API Call ───

async function invokeGatewayTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(`${GATEWAY_HTTP_URL}/tools/invoke`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
        },
        body: JSON.stringify({ tool, action: 'json', args }),
    });
    if (!res.ok) {
        throw new Error(`Gateway ${tool} failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok && data.error) {
        throw new Error(data.error.message || `Tool ${tool} error`);
    }

    // The gateway returns: { ok: true, result: { content: [{ type: "text", text: "JSON string" }] } }
    // We need to unwrap the MCP content array and parse the inner JSON.
    const result = data.result ?? data;

    // Handle MCP content array format
    if (result.content && Array.isArray(result.content)) {
        const textBlock = result.content.find(
            (c: { type: string; text?: string }) => c.type === 'text' && typeof c.text === 'string'
        );
        if (textBlock) {
            try {
                return JSON.parse(textBlock.text);
            } catch {
                return textBlock.text;
            }
        }
    }

    return result;
}

// ─── Public API ───

export async function fetchAgentSessions(): Promise<AgentData[]> {
    const result = await invokeGatewayTool('sessions_list', {
        messageLimit: 2,
    }) as Record<string, unknown>;

    // invokeGatewayTool now returns the parsed JSON: { count, sessions: [...] }
    const sessions = (result.sessions as Record<string, unknown>[]) || [];

    return sessions.map(session => {
        const key = (session.key as string) || '';
        const updatedAt = typeof session.updatedAt === 'number' ? session.updatedAt : undefined;

        return {
            id: (session.sessionId as string) || key,
            name: formatAgentName(key, session.displayName as string | undefined),
            role: deriveRole(key, session.channel as string | undefined),
            status: deriveStatus(session),
            currentTask: extractCurrentTask(session.messages as unknown[]),
            uptime: formatUptime(updatedAt),
            model: session.model as string | undefined,
            channel: session.channel as string | undefined,
            contextTokens: session.contextTokens as number | undefined,
            totalTokens: session.totalTokens as number | undefined,
            sessionKey: key,
            updatedAt,
            messages: (session.messages as MessageEntry[]) || [],
        };
    });
}

export async function fetchAgentDetail(sessionKey: string): Promise<AgentDetail | null> {
    // Fetch history for the specific session
    const result = await invokeGatewayTool('sessions_history', {
        sessionKey,
        limit: 20,
        includeTools: false,
    }) as Record<string, unknown>;

    // invokeGatewayTool now returns the parsed JSON directly
    const messages = (result.messages as Record<string, unknown>[]) || [];

    // Build logs from recent messages
    const logs = messages.slice(-10).map(msg => ({
        time: typeof msg.timestamp === 'string'
            ? new Date(msg.timestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
            : '—',
        message: typeof msg.content === 'string'
            ? msg.content.slice(0, 120) + (msg.content.length > 120 ? '…' : '')
            : '(no content)',
    }));

    return {
        id: sessionKey,
        name: formatAgentName(sessionKey),
        role: deriveRole(sessionKey),  // channel not available for detail calls
        status: 'active',
        currentTask: extractCurrentTask(messages as unknown[]),
        uptime: '—',
        sessionKey,
        logs,
        queue: [],
    };
}
