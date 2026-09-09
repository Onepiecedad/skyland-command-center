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
import { presenter, type PresenterState, type PresentStep } from '../voice/presenter';
import { Pause, Play, SkipForward, SkipBack, Square as StopIcon } from 'lucide-react';
import '../styles/alexdock.css';

interface ChatMsg {
    role: 'user' | 'assistant';
    content: string;
    /** Rent skärmkommando ("visa …"): visas som en diskret notis, läses aldrig upp. */
    note?: boolean;
}

interface ChatApiResponse {
    response?: string;
    conversation_id?: string;
    error?: string;
    ui_only?: boolean;
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
        async (text: string, channel: 'chat' | 'voice' = 'chat'): Promise<string | null> => {
            if (!text || busy) return null;
            setInput('');
            setMessages((prev) => [...prev, { role: 'user', content: text }]);
            setBusy(true);
            try {
                const res = await fetchWithAuth(`${API_BASE}/chat/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text, channel, conversation_id: conversationId }),
                });
                const data = (await res.json().catch(() => null)) as ChatApiResponse | null;
                if (res.ok && data?.response) {
                    if (data.conversation_id) setConversationId(data.conversation_id);
                    const note = data.ui_only === true;
                    setMessages((prev) => [...prev, { role: 'assistant', content: data.response as string, note }]);
                    // Skärmen är svaret: ingen uppläsning av "Visar Thomas, Hemsida."
                    return note ? null : data.response;
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
    const talk = useWalkieTalkie({ onTranscript: (t) => sendText(t, 'voice') });

    // Alex egen genomgång (present_screens): stegen spelas upp av presentern,
    // varje stegtext landar dessutom som notis i tråden när den läses upp.
    const [show, setShow] = useState<PresenterState | null>(null);
    useEffect(() => presenter.subscribe(setShow), []);
    useEffect(() => {
        const onPresent = (e: Event) => {
            const steps = (e as CustomEvent<{ steps: PresentStep[] }>).detail?.steps ?? [];
            if (!steps.length) return;
            talk.hush();
            setOpen(true);
            presenter.start(steps);
        };
        window.addEventListener('scc:present', onPresent);
        return () => window.removeEventListener('scc:present', onPresent);
    }, [talk]);
    const lastNotedRef = useRef<string>('');
    useEffect(() => {
        if (!show || show.status === 'done') return;
        const key = `${show.index}:${show.steps.length}`;
        if (lastNotedRef.current === key) return;
        lastNotedRef.current = key;
        const step = show.steps[show.index];
        const where = step.customer_name ?? step.contact_name ?? step.view ?? '';
        setMessages((prev) => [...prev, { role: 'assistant', content: `${where ? where + ': ' : ''}${step.say}`, note: true }]);
    }, [show]);
    const talking = talk.state !== 'idle';

    // Håll mellanslag = håll in knappen. Fungerar även när textfältet har
    // fokus (panelen fokuserar det vid öppning), så länge fältet är tomt.
    useEffect(() => {
        if (!open || !talk.supported) return;
        const down = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.repeat) return;
            const el = document.activeElement;
            const inField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
            if (inField && el !== inputRef.current) return;
            if (el === inputRef.current && inputRef.current?.value) return;
            e.preventDefault();
            talk.hush();
            void talk.start();
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') talk.stop();
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, [open, talk]);

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
                                            className={`alexdock-msg ${m.role === 'user' ? 'alexdock-msg--user' : m.note ? 'alexdock-msg--note' : 'alexdock-msg--assistant'}`}
                                        >
                                            {m.role === 'assistant' && !m.note ? (
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

                                {show && (
                                    <div className="alexdock-present">
                                        <span className="alexdock-present-label">
                                            {show.status === 'done' ? 'Klart' : `Genomgång ${show.index + 1}/${show.steps.length}`}
                                            {' · '}
                                            {show.steps[show.index]?.customer_name ?? show.steps[show.index]?.contact_name ?? show.steps[show.index]?.view}
                                        </span>
                                        <span className="alexdock-present-btns">
                                            <button type="button" onClick={() => presenter.prev()} title="Föregående"><SkipBack size={13} /></button>
                                            {show.status === 'playing'
                                                ? <button type="button" onClick={() => presenter.pause()} title="Paus"><Pause size={13} /></button>
                                                : <button type="button" onClick={() => presenter.resume()} title="Fortsätt"><Play size={13} /></button>}
                                            <button type="button" onClick={() => presenter.next()} title="Nästa"><SkipForward size={13} /></button>
                                            <button type="button" onClick={() => presenter.stop()} title="Avsluta"><StopIcon size={13} /></button>
                                        </span>
                                    </div>
                                )}
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
