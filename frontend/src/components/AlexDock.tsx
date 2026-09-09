/**
 * AlexDock — flytande, alltid tillgänglig Alex-chat (alla vyer).
 * Apple-känsla: glaspanel, spring-animation, ⌘J togglar, Esc stänger.
 * Kör server-Alex (/api/v1/chat/chat — full CRM-åtkomst). Håll-och-prata-knappen
 * går genom exakt samma sendText: rösten är ett annat tangentbord, inte en annan Alex.
 * Monteras på App-nivå så konversationen överlever vy-byten.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CollapsibleMarkdown } from './chat/CollapsibleMarkdown';
import { Mic, X, ArrowUp, Square } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../api';
import { useWalkieTalkie, TALK_LABEL } from '../hooks/useWalkieTalkie';
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

const SUGGESTIONS = [
    'Var i pipelinen är Skindiver?',
    'Lista tier A-prospekten',
    'Vilka sekvenser är aktiva?',
];

export function AlexDock() {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [conversationId, setConversationId] = useState<string | undefined>(undefined);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);


    // Öppnas från Alex-knappen i navigeringsklustret (scc:open-alex)
    useEffect(() => {
        const onOpenAlex = () => setOpen(true);
        window.addEventListener('scc:open-alex', onOpenAlex);
        return () => window.removeEventListener('scc:open-alex', onOpenAlex);
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
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, busy]);

    const sendText = useCallback(
        async (text: string): Promise<string | null> => {
            if (!text || busy) return null;
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
                    return data.response;
                }
                setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: `⚠️ ${data?.error || `Serverfel (${res.status})`}` },
                ]);
                return null;
            } catch {
                setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ Kunde inte nå servern.' }]);
                return null;
            } finally {
                setBusy(false);
            }
        },
        [busy, conversationId],
    );

    // Håll-och-prata: transkriptet går in i sendText ovan, svaret läses upp.
    const talk = useWalkieTalkie({ onTranscript: sendText });
    const talking = talk.state !== 'idle';

    // Håll mellanslag (utan fokus i textfältet) = håll in knappen.
    useEffect(() => {
        if (!open || !talk.supported) return;
        const isTyping = () => document.activeElement === inputRef.current && !!input;
        const down = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.repeat || isTyping()) return;
            if (document.activeElement === inputRef.current) return;
            e.preventDefault();
            talk.hush();
            void talk.start();
        };
        const up = (e: KeyboardEvent) => {
            if (e.code !== 'Space') return;
            talk.stop();
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, [open, input, talk]);

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        sendText(input.trim());
    };

    return (
        <>
            {/* Ingen egen flytande knapp längre — Alex öppnas från ✦ i
                navigeringsklustret (ett dragbart objekt, inte två). */}

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
                                <button className="alexdock-icon-btn" onClick={() => setOpen(false)} title="Stäng (Esc)">
                                    <X size={15} />
                                </button>
                            </div>
                        </div>

                        {/* Innehåll */}
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
                                    {(busy || talking) && (
                                        <div className={`alexdock-thinking ${talk.state === 'recording' ? 'alexdock-thinking--rec' : ''}`}>
                                            {talking ? TALK_LABEL[talk.state] : 'Alex tänker…'}
                                        </div>
                                    )}
                                    {talk.error && (
                                        <div className="alexdock-thinking alexdock-thinking--err" onClick={talk.clearError}>
                                            ⚠️ {talk.error}
                                        </div>
                                    )}
                                </div>

                                <form onSubmit={onSubmit} className="alexdock-inputrow">
                                    <input
                                        ref={inputRef}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        placeholder="Fråga Alex…"
                                    />
                                    {talk.supported && (
                                        <button
                                            type="button"
                                            className={`alexdock-mic alexdock-mic--${talk.state}`}
                                            disabled={busy && talk.state === 'idle'}
                                            title={talk.state === 'speaking' ? 'Tysta Alex' : 'Håll in och prata (eller håll mellanslag)'}
                                            onPointerDown={(e) => {
                                                e.preventDefault();
                                                if (talk.state === 'speaking') { talk.hush(); return; }
                                                void talk.start();
                                            }}
                                            onPointerUp={talk.stop}
                                            onPointerLeave={talk.stop}
                                            onPointerCancel={talk.stop}
                                            onContextMenu={(e) => e.preventDefault()}
                                        >
                                            {talk.state === 'speaking' ? <Square size={14} strokeWidth={2.5} /> : <Mic size={16} strokeWidth={2.25} />}
                                        </button>
                                    )}
                                    <button type="submit" disabled={busy || talking || !input.trim()} title="Skicka">
                                        <ArrowUp size={16} strokeWidth={2.5} />
                                    </button>
                                </form>
                        </>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
