/**
 * AlexDock — flytande, alltid tillgänglig Alex-chat (alla vyer).
 * Apple-känsla: glaspanel, spring-animation, ⌘J togglar, Esc stänger.
 * Kör server-Alex (/api/v1/chat/chat — full CRM-åtkomst) och kan växla till röstläge.
 * Monteras på App-nivå så konversationen överlever vy-byten.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CollapsibleMarkdown } from './chat/CollapsibleMarkdown';
import { Mic, MessageCircle, X, ArrowUp, Sparkles } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../api';
import VoiceChat from './VoiceChat';
import '../styles/alexdock.css';

interface ChatMsg {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatApiResponse {
    response?: string;
    conversation_id?: string;
    error?: string;
}

type DockMode = 'text' | 'voice';

interface AlexDockProps {
    /** Döljer den flytande knappen (t.ex. på Alex-vyn som har egen chat). */
    hidden?: boolean;
}

const SUGGESTIONS = [
    'Var i pipelinen är Skindiver?',
    'Lista tier A-prospekten',
    'Vilka sekvenser är aktiva?',
];

export function AlexDock({ hidden = false }: AlexDockProps) {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<DockMode>('text');
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [conversationId, setConversationId] = useState<string | undefined>(undefined);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // ── Dragbar FAB: håll och dra flyttar knappen (position sparas), kort
    //    tryck utan rörelse öppnar panelen. ──
    const FAB_KEY = 'scc-alexfab-pos';
    const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(() => {
        try { const s = localStorage.getItem(FAB_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
    });
    const fabDrag = useRef<{ sx: number; sy: number; bx: number; by: number; moved: boolean } | null>(null);

    const onFabPointerDown = useCallback((e: React.PointerEvent) => {
        const r = e.currentTarget.getBoundingClientRect();
        fabDrag.current = { sx: e.clientX, sy: e.clientY, bx: r.left, by: r.top, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, []);
    const onFabPointerMove = useCallback((e: React.PointerEvent) => {
        const d = fabDrag.current;
        if (!d) return;
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.moved = true;
        if (d.moved) {
            setFabPos({
                x: Math.max(6, Math.min(window.innerWidth - 62, d.bx + dx)),
                y: Math.max(6, Math.min(window.innerHeight - 62, d.by + dy)),
            });
        }
    }, []);
    const onFabPointerUp = useCallback((e: React.PointerEvent) => {
        const d = fabDrag.current;
        fabDrag.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        if (!d?.moved) { setOpen(true); return; }   // tryck utan drag → öppna
        setFabPos((p) => { if (p) { try { localStorage.setItem(FAB_KEY, JSON.stringify(p)); } catch { /* ignore */ } } return p; });
    }, []);

    // ⌘J / Ctrl+J togglar, Esc stänger
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                setOpen((o) => !o);
            } else if (e.key === 'Escape') {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (open && mode === 'text') inputRef.current?.focus();
    }, [open, mode]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, busy]);

    const sendText = useCallback(
        async (text: string) => {
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
        },
        [busy, conversationId],
    );

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        sendText(input.trim());
    };

    return (
        <>
            {/* Flytande knapp — dragbar (håll och dra), position sparas.
                Kort tryck utan rörelse öppnar panelen. */}
            <AnimatePresence>
                {!open && !hidden && (
                    <motion.button
                        key="fab"
                        className="alexdock-fab"
                        style={fabPos ? { left: fabPos.x, top: fabPos.y, right: 'auto', bottom: 'auto' } : undefined}
                        onPointerDown={onFabPointerDown}
                        onPointerMove={onFabPointerMove}
                        onPointerUp={onFabPointerUp}
                        title="Prata med Alex (⌘J) — dra för att flytta"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                    >
                        <Sparkles size={20} strokeWidth={2} />
                    </motion.button>
                )}
            </AnimatePresence>

            {/* Panel */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="panel"
                        className="alexdock-panel"
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 24, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                    >
                        {/* Header */}
                        <div className="alexdock-header">
                            <div className="alexdock-header-title">
                                <span className="alexdock-status-dot" />
                                <span>Alex</span>
                                <span className="alexdock-header-sub">server-läge · full CRM-åtkomst</span>
                            </div>
                            <div className="alexdock-header-actions">
                                <button
                                    className={`alexdock-icon-btn ${mode === 'voice' ? 'alexdock-icon-btn--active' : ''}`}
                                    onClick={() => setMode(mode === 'voice' ? 'text' : 'voice')}
                                    title={mode === 'voice' ? 'Till textchat' : 'Till röstchat'}
                                >
                                    {mode === 'voice' ? <MessageCircle size={15} /> : <Mic size={15} />}
                                </button>
                                <button className="alexdock-icon-btn" onClick={() => setOpen(false)} title="Stäng (Esc)">
                                    <X size={15} />
                                </button>
                            </div>
                        </div>

                        {/* Innehåll */}
                        {mode === 'voice' ? (
                            <div className="alexdock-voice">
                                <VoiceChat />
                            </div>
                        ) : (
                            <>
                                <div ref={scrollRef} className="alexdock-messages">
                                    {messages.length === 0 && !busy && (
                                        <div className="alexdock-empty">
                                            <p>Vad vill du veta?</p>
                                            <div className="alexdock-suggestions">
                                                {SUGGESTIONS.map((s) => (
                                                    <button key={s} onClick={() => sendText(s)}>
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {messages.map((m, i) => (
                                        <div
                                            key={i}
                                            className={`alexdock-msg ${m.role === 'user' ? 'alexdock-msg--user' : 'alexdock-msg--assistant'}`}
                                        >
                                            {m.role === 'assistant' ? (
                                                <CollapsibleMarkdown content={m.content} />
                                            ) : (
                                                m.content
                                            )}
                                        </div>
                                    ))}
                                    {busy && <div className="alexdock-thinking">Alex tänker…</div>}
                                </div>

                                <form onSubmit={onSubmit} className="alexdock-inputrow">
                                    <input
                                        ref={inputRef}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        placeholder="Fråga Alex…"
                                    />
                                    <button type="submit" disabled={busy || !input.trim()} title="Skicka">
                                        <ArrowUp size={16} strokeWidth={2.5} />
                                    </button>
                                </form>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
