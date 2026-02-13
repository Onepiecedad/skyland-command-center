/**
 * OpenClaw Gateway WebSocket Client
 * JSON-RPC protocol matching the OpenClaw Control UI
 */

// ============================================================================
// Helpers
// ============================================================================

/** Safely coerce any gateway value to a string.
 *  Handles content-block arrays like [{type:"text",text:"..."}] → concatenated text.
 */
function toStr(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.message;
    // Content-block arrays: [{type:"text", text:"..."}, ...]
    if (Array.isArray(v)) {
        const parts = v
            .map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object' && 'text' in item) return String((item as Record<string, unknown>).text ?? '');
                return '';
            })
            .filter(Boolean);
        if (parts.length > 0) return parts.join('\n');
    }
    // Generic object → try to extract common text fields
    if (typeof v === 'object' && v !== null) {
        const obj = v as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text;
        if (typeof obj.message === 'string') return obj.message;
        if (typeof obj.content === 'string') return obj.content;
    }
    try { return JSON.stringify(v); } catch { return String(v); }
}

/** Ensure a message from the gateway has string content (never an object). */
function sanitizeMessage(raw: Record<string, unknown>): GatewayMessage {
    return {
        role: (raw.role as GatewayMessage['role']) || 'assistant',
        content: toStr(raw.content ?? raw.text ?? ''),
        runId: raw.runId as string | undefined,
        toolCalls: raw.toolCalls as ToolCallInfo[] | undefined,
        timestamp: raw.timestamp as string | undefined,
    };
}

// ============================================================================
// Types
// ============================================================================

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected';
export type AlexState = 'idle' | 'thinking' | 'executing' | 'stuck' | 'unknown';

export interface ChatAttachment {
    id: string;
    name: string;
    type: string;          // MIME type
    size: number;
    data_b64: string;      // base64-encoded content
    preview?: string;      // object URL for local preview
}

export interface GatewayMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: ChatAttachment[];
    runId?: string;
    toolCalls?: ToolCallInfo[];
    timestamp?: string;
}

export interface ToolCallInfo {
    name: string;
    status: 'running' | 'done' | 'error';
    args?: Record<string, unknown>;
    result?: string;
}

export interface GatewayNode {
    id: string;
    name: string;
    platform: string;
    connected: boolean;
    capabilities?: string[];
}

export interface GatewaySession {
    key: string;
    label?: string;
    lastMessageAt?: string;
    channel?: string;
    model?: string;
    tokenCount?: number;
}

export interface MemoryEntry {
    id?: string;
    content: string;
    source?: string;
    sessionKey?: string;
    timestamp?: string;
    score?: number;
}

export interface ChatStreamChunk {
    kind: 'delta' | 'final' | 'error' | 'tool_start' | 'tool_end' | 'aborted';
    content?: string;
    runId?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    error?: string;
    sessionKey?: string;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

interface WsRequest {
    type: 'req';
    id: string;
    method: string;
    params: unknown;
}

interface WsResponse {
    type: 'res';
    id: string;
    ok: boolean;
    payload?: unknown;
    error?: { message: string };
}

interface WsEvent {
    type: 'event';
    event: string;
    payload?: unknown;
    seq?: number;
}

export interface GatewayEventHandlers {
    onStatusChange?: (status: GatewayStatus) => void;
    onChatEvent?: (chunk: ChatStreamChunk) => void;
    onPresence?: (entries: unknown[]) => void;
    onHello?: (payload: unknown) => void;
    onError?: (error: string) => void;
}

// ============================================================================
// Gateway Socket Client
// ============================================================================

export class GatewaySocket {
    private ws: WebSocket | null = null;
    private url: string;
    private token: string | null;
    private pending = new Map<string, PendingRequest>();
    private handlers: GatewayEventHandlers;
    private backoffMs = 800;
    private maxBackoffMs = 30000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _status: GatewayStatus = 'disconnected';
    private stopped = false;
    private connectSent = false;
    private connectTimer: ReturnType<typeof setTimeout> | null = null;
    private challengeNonce: string | null = null;

    constructor(url: string, handlers: GatewayEventHandlers = {}, token?: string) {
        this.url = url;
        this.token = token ?? null;
        this.handlers = handlers;
    }

    // --- Public API ---

    get status(): GatewayStatus {
        return this._status;
    }

    get connected(): boolean {
        return this._status === 'connected';
    }

    start(): void {
        this.stopped = false;
        this.connect();
    }

    stop(): void {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.connectTimer) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
        if (this.ws) {
            this.ws.close(1000, 'client stop');
            this.ws = null;
        }
        this.setStatus('disconnected');
    }

    async sendChatMessage(sessionKey: string, message: string, attachments?: ChatAttachment[]): Promise<void> {
        const payload: Record<string, unknown> = {
            sessionKey,
            message,
            idempotencyKey: crypto.randomUUID(),
        };
        if (attachments?.length) {
            payload.attachments = attachments.map(a => ({
                fileName: a.name,
                mimeType: a.type,
                content: a.data_b64,
            }));
        }
        await this.request('chat.send', payload);
    }

    async abortChat(): Promise<void> {
        await this.request('chat.abort', {});
    }

    async getChatHistory(sessionKey: string, limit = 200): Promise<{ messages: GatewayMessage[] }> {
        const result = await this.request('chat.history', { sessionKey, limit });
        const data = result as { messages?: unknown[] };
        const messages = (data.messages || []).map((m) => sanitizeMessage(m as Record<string, unknown>));
        return { messages };
    }

    async getNodes(): Promise<GatewayNode[]> {
        const result = await this.request('node.list', {});
        const data = result as { nodes?: GatewayNode[] };
        return data.nodes || [];
    }

    async getSessions(agentId = 'main'): Promise<GatewaySession[]> {
        try {
            const result = await this.request('sessions.list', { agentId });
            const data = result as { sessions?: unknown[] };
            return (data.sessions || []).map((s) => {
                const raw = s as Record<string, unknown>;
                return {
                    key: String(raw.key || raw.sessionKey || ''),
                    label: raw.label as string | undefined,
                    lastMessageAt: raw.lastMessageAt as string | undefined,
                    channel: raw.channel as string | undefined,
                    model: raw.model as string | undefined,
                    tokenCount: raw.tokenCount as number | undefined,
                } as GatewaySession;
            });
        } catch {
            // Fallback: gateway may not support sessions.list — return empty
            console.warn('[GW] sessions.list not supported, returning empty');
            return [];
        }
    }

    async createSession(agentId = 'main'): Promise<string> {
        const sessionKey = `agent:${agentId}:scc:${crypto.randomUUID().slice(0, 8)}`;
        // Warm up the session by sending an empty history request
        // This ensures the gateway knows about this session key
        try {
            await this.request('chat.history', { sessionKey, limit: 1 });
        } catch {
            // Ignore — session may not exist yet, which is fine
        }
        return sessionKey;
    }

    /**
     * Public JSON-RPC call — allows external modules like fleetApi
     * to call gateway RPC methods directly (e.g. sessions.list).
     */
    async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        return this.request(method, params);
    }

    async searchMemory(query: string, limit = 20): Promise<MemoryEntry[]> {
        // Use SCC backend API instead of gateway RPC
        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
            const res = await fetch(`${apiUrl}/api/v1/alex/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit }),
            });
            if (!res.ok) {
                console.warn('[GW] alex/search failed:', res.status);
                return [];
            }
            const data = await res.json();
            return (data.entries || []).map((e: Record<string, unknown>) => ({
                id: e.id as string,
                content: e.content as string,
                source: e.source as string,
                timestamp: e.timestamp as string,
                score: e.score as number,
            }));
        } catch (err) {
            console.warn('[GW] alex/search error:', err);
            return [];
        }
    }

    async getMemoryEntries(limit = 50): Promise<MemoryEntry[]> {
        // Use SCC backend API instead of gateway RPC
        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
            const res = await fetch(`${apiUrl}/api/v1/alex/list?limit=${limit}`);
            if (!res.ok) {
                console.warn('[GW] alex/list failed:', res.status);
                return [];
            }
            const data = await res.json();
            return (data.entries || []).map((e: Record<string, unknown>) => ({
                id: e.id as string,
                content: e.content as string,
                source: e.source as string,
                timestamp: e.timestamp as string,
            }));
        } catch (err) {
            console.warn('[GW] alex/list error:', err);
            return [];
        }
    }

    // --- Connection Management ---

    private connect(): void {
        if (this.stopped) return;
        this.setStatus('connecting');

        try {
            this.ws = new WebSocket(this.url);
        } catch {
            this.scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            // Queue connect with delay — matches gateway protocol.
            // Allows connect.challenge to arrive and set nonce before we send.
            this.queueConnect();
        };

        this.ws.onmessage = (evt) => {
            this.handleMessage(evt.data as string);
        };

        this.ws.onclose = (evt) => {
            this.ws = null;
            this.rejectAllPending('connection closed');
            if (!this.stopped) {
                this.setStatus('disconnected');
                if (evt.code !== 1000) {
                    this.scheduleReconnect();
                }
            }
        };

        this.ws.onerror = () => {
            // onclose will fire after this
        };
    }

    private queueConnect(): void {
        this.connectSent = false;
        if (this.connectTimer !== null) {
            clearTimeout(this.connectTimer);
        }
        this.connectTimer = setTimeout(() => {
            this.connectTimer = null;
            this.sendConnect();
        }, 750);
    }

    private sendConnect(): void {
        // Only send once per connection — deduplicate
        if (this.connectSent) return;
        this.connectSent = true;
        if (this.connectTimer !== null) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }

        const params: Record<string, unknown> = {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: 'webchat-ui',
                version: '2.0.0',
                platform: navigator.platform || 'web',
                mode: 'webchat',
                instanceId: `scc-${Date.now()}`,
            },
            role: 'operator',
            scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
            caps: [],
            auth: this.token ? { token: this.token } : undefined,
            userAgent: navigator.userAgent,
            locale: navigator.language,
        };

        this.request('connect', params)
            .then((payload) => {
                this.backoffMs = 800;
                this.setStatus('connected');
                this.handlers.onHello?.(payload);
            })
            .catch(() => {
                this.ws?.close(4001, 'connect failed');
            });
    }

    private handleMessage(raw: string): void {
        let msg: WsResponse | WsEvent;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        // Debug trace
        if (msg.type === 'event') {
            console.debug('[GW] event:', (msg as WsEvent).event);
        } else if (msg.type === 'res') {
            console.debug('[GW] res:', (msg as WsResponse).id, (msg as WsResponse).ok);
        }

        if (msg.type === 'event') {
            const evt = msg as WsEvent;

            // Handle connect challenge — store nonce and send connect
            if (evt.event === 'connect.challenge') {
                const payload = evt.payload as { nonce?: string } | null;
                this.challengeNonce = payload?.nonce ?? null;
                console.debug('[GW] challenge nonce:', this.challengeNonce?.slice(0, 8) + '…');
                this.sendConnect();
                return;
            }

            // Route events
            if (evt.event === 'chat') {
                const cp = evt.payload as Record<string, unknown> | null;
                console.debug('[GW] chat event:', cp?.kind || cp?.state || 'unknown');
                this.handleChatEvent(evt.payload);
            } else if (evt.event === 'presence') {
                const p = evt.payload as { presence?: unknown[] };
                if (p?.presence) {
                    this.handlers.onPresence?.(p.presence);
                }
            }
            return;
        }

        if (msg.type === 'res') {
            const res = msg as WsResponse;
            const pending = this.pending.get(res.id);
            if (!pending) return;
            this.pending.delete(res.id);

            if (res.ok) {
                pending.resolve(res.payload);
            } else {
                console.warn('[GW] request failed:', res.error?.message);
                pending.reject(new Error(res.error?.message || 'request failed'));
            }
        }
    }

    private handleChatEvent(payload: unknown): void {
        const p = payload as Record<string, unknown> | null;
        if (!p) return;

        // Gateway may send 'state' or 'kind' for event type
        const kind = (p.kind as string) || (p.state as string) || 'delta';
        const chunk: ChatStreamChunk = { kind: kind as ChatStreamChunk['kind'] };

        if (kind === 'delta' || kind === 'final') {
            // Content may be at p.text, p.content, or nested in p.message.content
            let content = toStr(p.text) || toStr(p.content);
            if (!content && p.message && typeof p.message === 'object') {
                const msg = p.message as Record<string, unknown>;
                content = toStr(msg.content) || toStr(msg.text);
            }
            chunk.content = content;
            chunk.runId = p.runId as string;
            chunk.sessionKey = p.sessionKey as string;
        } else if (kind === 'error') {
            chunk.error = toStr(p.error) || 'Unknown error';
            chunk.runId = p.runId as string;
        } else if (kind === 'tool_call' || kind === 'tool_start') {
            chunk.kind = 'tool_start';
            chunk.toolName = (p.name as string) || (p.toolName as string);
            chunk.toolArgs = p.args as Record<string, unknown>;
            chunk.runId = p.runId as string;
        } else if (kind === 'tool_result' || kind === 'tool_end') {
            chunk.kind = 'tool_end';
            chunk.toolName = (p.name as string) || (p.toolName as string);
            chunk.toolResult = (p.result as string) || (p.output as string);
            chunk.runId = p.runId as string;
        } else if (kind === 'aborted') {
            chunk.kind = 'aborted';
            chunk.runId = p.runId as string;
        }

        this.handlers.onChatEvent?.(chunk);
    }

    private request(method: string, params: unknown): Promise<unknown> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('gateway not connected'));
        }

        const id = crypto.randomUUID();
        const msg: WsRequest = { type: 'req', id, method, params };

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws!.send(JSON.stringify(msg));
        });
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 1.5, this.maxBackoffMs);
    }

    private rejectAllPending(reason: string): void {
        for (const [id, p] of this.pending) {
            p.reject(new Error(reason));
            this.pending.delete(id);
        }
    }

    private setStatus(s: GatewayStatus): void {
        if (this._status !== s) {
            this._status = s;
            this.handlers.onStatusChange?.(s);
        }
    }
}

// ============================================================================
// Singleton helper
// ============================================================================

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN || '';

let sharedSocket: GatewaySocket | null = null;

/**
 * Register an externally-created socket as the shared singleton.
 * Called by useGateway so that fleetApi can reuse its connected socket.
 */
export function setSharedSocket(socket: GatewaySocket | null): void {
    sharedSocket = socket;
}

export function getGatewaySocket(handlers?: GatewayEventHandlers): GatewaySocket {
    if (!sharedSocket) {
        sharedSocket = new GatewaySocket(GATEWAY_URL, handlers, GATEWAY_TOKEN || undefined);
    }
    return sharedSocket;
}
