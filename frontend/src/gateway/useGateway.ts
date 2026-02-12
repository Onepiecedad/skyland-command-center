/**
 * React hook for OpenClaw Gateway integration
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    GatewaySocket,
    type GatewayStatus,
    type AlexState,
    type GatewayMessage,
    type GatewayNode,
    type GatewaySession,
    type MemoryEntry,
    type ChatAttachment,
    type ChatStreamChunk,
} from './gatewaySocket';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN || '';

// Internal messages that should never appear in the chat UI
const SYSTEM_MSG_PATTERNS = [
    'HEARTBEAT',
    'Read HEARTBEAT.md',
    'HEARTBEAT_OK',
    'Cron:',
    'A scheduled reminder has been triggered',
];

function isSystemMessage(msg: { role?: string; content?: string }): boolean {
    if (!msg.content) return false;
    const c = msg.content.trim();
    return SYSTEM_MSG_PATTERNS.some(p => c.includes(p));
}

export interface ThreadPreview {
    lastMessage: string;
    messageCount: number;
}

export interface UseGatewayResult {
    status: GatewayStatus;
    alexState: AlexState;
    messages: GatewayMessage[];
    streamingContent: string;
    isStreaming: boolean;
    nodes: GatewayNode[];
    sessions: GatewaySession[];
    threadPreviews: Record<string, ThreadPreview>;
    memoryEntries: MemoryEntry[];
    sessionKey: string;
    sendMessage: (text: string, attachments?: ChatAttachment[], model?: string) => void;
    abortChat: () => void;
    loadHistory: () => void;
    setSessionKey: (key: string) => void;
    refreshSessions: () => void;
    createNewSession: () => Promise<string>;
    searchMemory: (query: string) => Promise<void>;
}

export function useGateway(initialSessionKey = 'agent:skyland:main', options?: { disabled?: boolean }): UseGatewayResult {
    const disabled = options?.disabled ?? false;
    const [status, setStatus] = useState<GatewayStatus>('disconnected');
    const [alexState, setAlexState] = useState<AlexState>('unknown');
    const [messages, setMessages] = useState<GatewayMessage[]>([]);
    const [streamingContent, setStreamingContent] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [nodes, setNodes] = useState<GatewayNode[]>([]);
    const [sessions, setSessions] = useState<GatewaySession[]>([]);
    const [threadPreviews, setThreadPreviews] = useState<Record<string, ThreadPreview>>({});
    const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
    const [sessionKey, setSessionKey] = useState(initialSessionKey);

    const socketRef = useRef<GatewaySocket | null>(null);
    const streamBuf = useRef('');
    const currentRunId = useRef<string | null>(null);
    const activeTools = useRef<Map<string, { name: string; status: string }>>(new Map());
    const seenRunIds = useRef<Set<string>>(new Set());

    // --- Chat event handler ---
    const handleChatEvent = useCallback((chunk: ChatStreamChunk) => {
        switch (chunk.kind) {
            case 'delta':
                streamBuf.current += chunk.content || '';
                setStreamingContent(streamBuf.current);
                setIsStreaming(true);
                setAlexState('thinking');
                if (chunk.runId) currentRunId.current = chunk.runId;
                break;

            case 'final': {
                // Deduplicate: skip if we already processed this runId
                if (chunk.runId && seenRunIds.current.has(chunk.runId)) break;
                if (chunk.runId) seenRunIds.current.add(chunk.runId);

                const finalText = streamBuf.current + (chunk.content || '');
                streamBuf.current = '';
                setStreamingContent('');
                setIsStreaming(false);
                setAlexState('idle');
                currentRunId.current = null;

                // Skip internal system messages
                if (isSystemMessage({ content: finalText })) break;

                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: finalText,
                    timestamp: new Date().toISOString(),
                    runId: chunk.runId,
                }]);
                break;
            }

            case 'tool_start':
                setAlexState('executing');
                if (chunk.toolName) {
                    activeTools.current.set(chunk.toolName, {
                        name: chunk.toolName,
                        status: 'running',
                    });
                }
                break;

            case 'tool_end':
                if (chunk.toolName) {
                    activeTools.current.delete(chunk.toolName);
                }
                if (activeTools.current.size === 0) {
                    setAlexState('thinking');
                }
                break;

            case 'error':
                streamBuf.current = '';
                setStreamingContent('');
                setIsStreaming(false);
                setAlexState('idle');
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `⚠️ Error: ${chunk.error || 'Unknown error'}`,
                    timestamp: new Date().toISOString(),
                }]);
                break;

            case 'aborted':
                streamBuf.current = '';
                setStreamingContent('');
                setIsStreaming(false);
                setAlexState('idle');
                break;
        }
    }, []);

    // --- Connect on mount (skip if disabled) ---
    useEffect(() => {
        if (disabled) return;
        const socket = new GatewaySocket(GATEWAY_URL, {
            onStatusChange: (s) => {
                setStatus(s);
                if (s === 'disconnected') {
                    setAlexState('unknown');
                } else if (s === 'connected') {
                    setAlexState('idle');
                }
            },
            onChatEvent: handleChatEvent,
            onPresence: (entries) => {
                // Presence events tell us what Alex is doing
                const busy = entries.some((e: unknown) => {
                    const entry = e as Record<string, unknown>;
                    return entry.state === 'busy' || entry.state === 'thinking';
                });
                if (busy) setAlexState('executing');
            },
            onHello: () => {
                // On connect, fetch nodes + sessions
                socket.getNodes()
                    .then(setNodes)
                    .catch(() => { });
                socket.getSessions()
                    .then(setSessions)
                    .catch(() => { });
            },
            onError: (err) => {
                console.error('[gateway]', err);
            },
        }, GATEWAY_TOKEN || undefined);

        socketRef.current = socket;
        socket.start();

        return () => {
            socket.stop();
            socketRef.current = null;
        };
    }, [handleChatEvent, disabled]);

    // --- Refresh nodes + sessions periodically ---
    useEffect(() => {
        if (status !== 'connected') return;
        const interval = setInterval(() => {
            socketRef.current?.getNodes()
                .then(setNodes)
                .catch(() => { });
            socketRef.current?.getSessions()
                .then(setSessions)
                .catch(() => { });
        }, 30000);
        return () => clearInterval(interval);
    }, [status]);

    // --- Fetch thread previews when sessions change ---
    useEffect(() => {
        if (!socketRef.current?.connected || sessions.length === 0) return;

        const fetchPreviews = async () => {
            const previews: Record<string, ThreadPreview> = {};
            const socket = socketRef.current;
            if (!socket) return;

            await Promise.all(
                sessions.map(async (s) => {
                    try {
                        const result = await socket.getChatHistory(s.key, 3);
                        const msgs = result.messages || [];
                        const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
                        const lastAny = msgs[msgs.length - 1];
                        const preview = lastAssistant?.content || lastAny?.content || '';
                        previews[s.key] = {
                            lastMessage: preview.slice(0, 120),
                            messageCount: msgs.length,
                        };
                    } catch {
                        previews[s.key] = { lastMessage: '', messageCount: 0 };
                    }
                })
            );

            setThreadPreviews(previews);
        };

        fetchPreviews();
    }, [sessions]);
    // --- Public methods ---
    const sendMessage = useCallback((text: string, attachments?: ChatAttachment[], model?: string) => {
        if (!socketRef.current?.connected || (!text.trim() && !attachments?.length)) return;

        // Add user message immediately
        setMessages(prev => [...prev, {
            role: 'user',
            content: text,
            attachments,
            timestamp: new Date().toISOString(),
        }]);
        streamBuf.current = '';
        setStreamingContent('');
        setIsStreaming(true);
        setAlexState('thinking');

        socketRef.current.sendChatMessage(sessionKey, text, attachments, model).catch((err) => {
            setIsStreaming(false);
            setAlexState('idle');
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `⚠️ Failed to send: ${err.message}`,
            }]);
        });
    }, [sessionKey]);

    const abortChat = useCallback(() => {
        socketRef.current?.abortChat().catch(() => { });
    }, []);

    const loadHistory = useCallback(() => {
        if (!socketRef.current?.connected) return;
        socketRef.current.getChatHistory(sessionKey)
            .then((result) => {
                if (result.messages?.length) {
                    setMessages(result.messages.filter(m => !isSystemMessage(m)));
                } else {
                    setMessages([]);
                }
            })
            .catch(() => { });
    }, [sessionKey]);

    const refreshSessions = useCallback(() => {
        if (!socketRef.current?.connected) return;
        socketRef.current.getSessions()
            .then(setSessions)
            .catch(() => { });
    }, []);

    const createNewSession = useCallback(async (): Promise<string> => {
        if (!socketRef.current?.connected) throw new Error('Not connected');
        const newKey = await socketRef.current.createSession();
        // Refresh sessions list
        refreshSessions();
        // Switch to the new session
        setSessionKey(newKey);
        setMessages([]);
        return newKey;
    }, [refreshSessions]);

    // Load history when session changes and connected
    useEffect(() => {
        if (status === 'connected') {
            loadHistory();
        }
    }, [status, sessionKey, loadHistory]);

    const searchMemoryFn = useCallback(async (query: string) => {
        if (!socketRef.current?.connected) return;
        try {
            const entries = query.trim()
                ? await socketRef.current.searchMemory(query)
                : await socketRef.current.getMemoryEntries();
            setMemoryEntries(entries);
        } catch {
            setMemoryEntries([]);
        }
    }, []);

    // Initial memory fetch on connect
    useEffect(() => {
        if (status === 'connected' && socketRef.current) {
            socketRef.current.getMemoryEntries(30)
                .then(setMemoryEntries)
                .catch(() => setMemoryEntries([]));
        }
    }, [status]);

    return {
        status,
        alexState,
        messages,
        streamingContent,
        isStreaming,
        nodes,
        sessions,
        threadPreviews,
        memoryEntries,
        sessionKey,
        sendMessage,
        abortChat,
        loadHistory,
        setSessionKey,
        refreshSessions,
        createNewSession,
        searchMemory: searchMemoryFn,
    };
}
