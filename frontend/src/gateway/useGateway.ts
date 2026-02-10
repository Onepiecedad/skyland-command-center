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
    type ChatStreamChunk,
} from './gatewaySocket';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN || '';

export interface UseGatewayResult {
    status: GatewayStatus;
    alexState: AlexState;
    messages: GatewayMessage[];
    streamingContent: string;
    isStreaming: boolean;
    nodes: GatewayNode[];
    sessionKey: string;
    sendMessage: (text: string) => void;
    abortChat: () => void;
    loadHistory: () => void;
    setSessionKey: (key: string) => void;
}

export function useGateway(initialSessionKey = 'agent:skyland:main'): UseGatewayResult {
    const [status, setStatus] = useState<GatewayStatus>('disconnected');
    const [alexState, setAlexState] = useState<AlexState>('unknown');
    const [messages, setMessages] = useState<GatewayMessage[]>([]);
    const [streamingContent, setStreamingContent] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [nodes, setNodes] = useState<GatewayNode[]>([]);
    const [sessionKey, setSessionKey] = useState(initialSessionKey);

    const socketRef = useRef<GatewaySocket | null>(null);
    const streamBuf = useRef('');
    const currentRunId = useRef<string | null>(null);
    const activeTools = useRef<Map<string, { name: string; status: string }>>(new Map());

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
                const finalText = streamBuf.current + (chunk.content || '');
                streamBuf.current = '';
                setStreamingContent('');
                setIsStreaming(false);
                setAlexState('idle');
                currentRunId.current = null;
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

    // --- Connect on mount ---
    useEffect(() => {
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
                // On connect, fetch nodes
                socket.getNodes()
                    .then(setNodes)
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
    }, [handleChatEvent]);

    // --- Refresh nodes periodically ---
    useEffect(() => {
        if (status !== 'connected') return;
        const interval = setInterval(() => {
            socketRef.current?.getNodes()
                .then(setNodes)
                .catch(() => { });
        }, 30000);
        return () => clearInterval(interval);
    }, [status]);

    // --- Public methods ---
    const sendMessage = useCallback((text: string) => {
        if (!socketRef.current?.connected || !text.trim()) return;

        // Add user message immediately
        setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }]);
        streamBuf.current = '';
        setStreamingContent('');
        setIsStreaming(true);
        setAlexState('thinking');

        socketRef.current.sendChatMessage(sessionKey, text).catch((err) => {
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
                    setMessages(result.messages);
                }
            })
            .catch(() => { });
    }, [sessionKey]);

    // Load history when session changes and connected
    useEffect(() => {
        if (status === 'connected') {
            loadHistory();
        }
    }, [status, sessionKey, loadHistory]);

    return {
        status,
        alexState,
        messages,
        streamingContent,
        isStreaming,
        nodes,
        sessionKey,
        sendMessage,
        abortChat,
        loadHistory,
        setSessionKey,
    };
}
