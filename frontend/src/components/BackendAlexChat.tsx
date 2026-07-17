/**
 * SCC-38 — Backend-Alex: chatt via /api/v1/chat/chat (serverside Master Brain
 * med CRM-verktyg via OpenRouter). Används som fallback när OpenClaw-gatewayen
 * (Joakims Mac) inte är nåbar — t.ex. på scc.skylandai.se eller mobilen.
 * Sessionscookien autentiserar; inga hemligheter i klienten.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CollapsibleMarkdown } from './chat/CollapsibleMarkdown';
import { API_BASE, fetchWithAuth } from '../api';

interface ChatMsg {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatApiResponse {
    response?: string;
    conversation_id?: string;
    error?: string;
}

export function BackendAlexChat() {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [conversationId, setConversationId] = useState<string | undefined>(undefined);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, busy]);

    const send = async (e: FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || busy) return;
        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setBusy(true);
        try {
            const res = await fetchWithAuth(`${API_BASE}/chat/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, channel: 'chat', conversation_id: conversationId }),
            });
            const data = (await res.json().catch(() => null)) as ChatApiResponse | null;
            if (res.ok && data?.response) {
                if (data.conversation_id) setConversationId(data.conversation_id);
                setMessages((prev) => [...prev, { role: 'assistant', content: data.response as string }]);
            } else {
                setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: `⚠️ ${data?.error || `Serverfel (${res.status})`}` },
                ]);
            }
        } catch {
            setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ Kunde inte nå servern.' }]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Läges-banner */}
            <div
                style={{
                    padding: '8px 14px',
                    fontSize: 12,
                    borderRadius: 10,
                    marginBottom: 10,
                    background: 'rgba(124,140,255,0.12)',
                    border: '1px solid rgba(124,140,255,0.3)',
                    color: '#aab4ff',
                }}
            >
                Server-läge — Alex kör i molnet med full CRM-åtkomst. Sub-agenter och skills
                kräver gatewayen (din dator) och är inte tillgängliga här.
            </div>

            {/* Meddelanden */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 2px', minHeight: 0 }}>
                {messages.length === 0 && !busy && (
                    <div style={{ opacity: 0.45, fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                        Prata med Alex — "lista tier A-prospekten", "var i pipelinen är Skindiver?",
                        "flytta TELLO till Outreach Ready"…
                    </div>
                )}
                {messages.map((m, i) => (
                    <div
                        key={i}
                        style={{
                            display: 'flex',
                            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                            marginBottom: 10,
                        }}
                    >
                        <div
                            style={{
                                maxWidth: '78%',
                                padding: '10px 14px',
                                borderRadius: 14,
                                fontSize: 14,
                                lineHeight: 1.5,
                                background:
                                    m.role === 'user' ? 'rgba(124,140,255,0.9)' : 'rgba(255,255,255,0.07)',
                                color: m.role === 'user' ? '#0b0b0f' : '#e8eaf6',
                                border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.10)',
                            }}
                        >
                            {m.role === 'assistant' ? (
                                <CollapsibleMarkdown content={m.content} />
                            ) : (
                                m.content
                            )}
                        </div>
                    </div>
                ))}
                {busy && (
                    <div style={{ opacity: 0.55, fontSize: 13, padding: '4px 8px' }}>Alex tänker…</div>
                )}
            </div>

            {/* Input */}
            <form onSubmit={send} style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Prata med Alex…"
                    style={{
                        flex: 1,
                        padding: '12px 16px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.15)',
                        background: 'rgba(0,0,0,0.35)',
                        color: '#e8eaf6',
                        fontSize: 14,
                        outline: 'none',
                    }}
                />
                <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    style={{
                        padding: '0 20px',
                        borderRadius: 12,
                        border: 'none',
                        background: busy || !input.trim() ? 'rgba(124,140,255,0.35)' : '#7c8cff',
                        color: '#0b0b0f',
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: busy || !input.trim() ? 'default' : 'pointer',
                    }}
                >
                    Skicka
                </button>
            </form>
        </div>
    );
}
