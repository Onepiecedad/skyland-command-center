/**
 * Fleet API — Gateway WebSocket bridge for agent session data
 *
 * Uses the shared GatewaySocket's rpc() method to call
 * sessions.list and chat.history over WebSocket,
 * bypassing CORS restrictions that block direct HTTP POST calls.
 */

import { getGatewaySocket, type GatewaySocket } from './gatewaySocket';

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
 */
function formatAgentName(key: string, displayName?: string): string {
    const parts = key.split(':');

    if (parts.includes('main')) return 'Alex';

    const channelType = parts[2];
    const identParts = parts.slice(3);
    const namedParts = identParts.filter(p => !isUuid(p));

    if (namedParts.length > 0) {
        const label = namedParts
            .join(' ')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        const prefix = channelType === 'scc' ? 'SCC' : channelType === 'cron' ? 'Cron' : channelType === 'hook' ? 'Hook' : '';
        return prefix ? `${prefix} ${label}` : label;
    }

    if (channelType === 'scc') {
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

    const raw = parts[parts.length - 1];
    return isUuid(raw) ? `Agent ${raw.slice(0, 6)}` : raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function deriveRole(key: string, channel?: string): string {
    const lower = key.toLowerCase();
    if (lower.includes(':main')) return 'Huvudagent';
    if (lower.includes(':cron:')) return 'Schemalagt jobb';
    if (lower.includes(':hook:')) return 'Webhook-trigger';

    if (lower.includes(':scc:')) {
        if (lower.includes('test') || lower.includes('e2e')) return 'Testning';
        if (channel === 'whatsapp') return 'WhatsApp-session';
        return 'SCC-chatt';
    }

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
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown>;
        if (msg.role === 'user' && typeof msg.content === 'string') {
            const text = msg.content.trim();
            return text.length > 80 ? text.slice(0, 77) + '…' : text;
        }
    }
    return 'Senaste aktivitet saknas';
}

// ─── Gateway RPC via WebSocket ───

/** Get the shared gateway socket instance */
function getSocket(): GatewaySocket {
    return getGatewaySocket();
}

/**
 * Call a gateway JSON-RPC method directly over WebSocket.
 * Waits up to 5 seconds for the socket to connect (handles mount race).
 */
async function gatewayRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const socket = getSocket();

    // Wait for socket to connect (useGateway may still be in its useEffect)
    if (!socket.connected) {
        const maxWait = 5000;
        const interval = 500;
        let waited = 0;
        while (!socket.connected && waited < maxWait) {
            await new Promise(r => setTimeout(r, interval));
            waited += interval;
        }
        if (!socket.connected) {
            throw new Error('Gateway not connected');
        }
    }

    return socket.rpc(method, params);
}

// ─── Public API ───

export async function fetchAgentSessions(): Promise<AgentData[]> {
    const result = await gatewayRpc('sessions.list', {
        agentId: 'main',
    }) as Record<string, unknown>;

    const sessions = (result.sessions as Record<string, unknown>[]) || [];

    return sessions.map(session => {
        const key = (session.key as string) || (session.sessionKey as string) || '';
        const updatedAt = typeof session.updatedAt === 'number'
            ? session.updatedAt
            : typeof session.lastMessageAt === 'string'
                ? new Date(session.lastMessageAt).getTime()
                : undefined;

        return {
            id: (session.sessionId as string) || key,
            name: formatAgentName(key, session.displayName as string | undefined),
            role: deriveRole(key, session.channel as string | undefined),
            status: deriveStatus({ ...session, updatedAt }),
            currentTask: extractCurrentTask(session.messages as unknown[]),
            uptime: formatUptime(updatedAt),
            model: session.model as string | undefined,
            channel: session.channel as string | undefined,
            contextTokens: session.contextTokens as number | undefined,
            totalTokens: (session.tokenCount as number) || (session.totalTokens as number) || undefined,
            sessionKey: key,
            updatedAt,
            messages: (session.messages as MessageEntry[]) || [],
        };
    });
}

export async function fetchAgentDetail(sessionKey: string): Promise<AgentDetail | null> {
    const result = await gatewayRpc('chat.history', {
        sessionKey,
        limit: 20,
    }) as Record<string, unknown>;

    const messages = (result.messages as Record<string, unknown>[]) || [];

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
        role: deriveRole(sessionKey),
        status: 'active',
        currentTask: extractCurrentTask(messages as unknown[]),
        uptime: '—',
        sessionKey,
        logs,
        queue: [],
    };
}
