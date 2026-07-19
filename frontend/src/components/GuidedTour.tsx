/**
 * GuidedTour — berättad demo av HELA ARBETSPROCESSEN, i flödesordning.
 *
 * Startas av Alex (start_ui_tour → SSE → 'scc:start-tour'). Varje steg
 * fokuserar rätt vy, kan utföra en UI-handling (öppna/stänga kontaktkort)
 * och berättas av Alex ElevenLabs-röst via /voice/tts. Nästa stegs ljud
 * FÖRHÄMTAS medan nuvarande spelas — inga tysta partier mellan stegen.
 * Deterministisk enligt husdoktrinen: identisk berättelse varje gång.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { navigateToView } from '../navigation/uiActions';
import { API_BASE } from '../api';

type TourAction = 'open-card' | 'close-card';

interface TourStep {
    view: string;
    title: string;
    text: string;
    /** Timer-fallback (ms) om berättarrösten inte kan spelas */
    duration: number;
    /** UI-handling som utförs strax efter vybytet */
    action?: TourAction;
}

// Berättelsen följer ARBETSPROCESSEN, inte menyordningen. Talskriven svenska
// i Joakims ton. Ändra tonen? Skriv om här — ren data.
const TOUR_STEPS: TourStep[] = [
    {
        view: 'alex',
        title: 'Ordern',
        text: 'Allt börjar med en order här. Jag skriver till Alex: hitta tatuerare i Göteborg, gör research på varje studio, bygg berikade kort och skriv personliga DM. Det är hela beställningen. Resten sköter systemet.',
        duration: 13000,
    },
    {
        view: 'office',
        title: 'Kontoret jobbar',
        text: 'Kontoret tar över. Researchern gräver fram verifierade fakta om varje studio, skribenten formar utkasten, och varje steg passerar hårda kvalitetsgrindar. Kostnaden? Under femtio öre per studio.',
        duration: 13000,
    },
    {
        view: 'crm',
        title: 'Resultatet landar',
        text: 'Resultatet landar här i CRM:et. Färdiga kort, poängsatta och sorterade, med kontaktvägar, adress och allt.',
        duration: 9000,
    },
    {
        view: 'crm',
        title: 'Ett kort',
        text: 'Vi öppnar ett kort. Här ligger researchen med källor, och ett personligt DM klart att kopiera och skicka. Ett svep till Contacted, så loggas meddelandet automatiskt.',
        duration: 12000,
        action: 'open-card',
    },
    {
        view: 'sequences',
        title: 'Sekvenserna',
        text: 'När dialogen väl rullar tar sekvenserna vid. Mejlflöden, påminnelser, uppföljning när någon inte dyker upp. Allt bakom en kill switch tills du säger kör.',
        duration: 11000,
        action: 'close-card',
    },
    {
        view: 'website',
        title: 'Hemsidan vakar',
        text: 'Samtidigt jobbar hemsidan. Den bevakar varje besök och varje samtal, dygnet runt.',
        duration: 8000,
    },
    {
        view: 'leads',
        title: 'Leads in',
        text: 'Och allt den fångar landar här. Varje lead blir en kontakt i CRM:et. Inget tappas.',
        duration: 8000,
    },
    {
        view: 'system',
        title: 'Maskinrummet',
        text: 'Maskinrummet loggar allt. Körningar, kostnader, varje händelse, ner på öret.',
        duration: 8000,
    },
    {
        view: 'alex',
        title: 'Och i mitten',
        text: 'Och i mitten sitter jag och koordinerar. Du ger ordern, jag driver maskinen, du godkänner det som går ut. Det är Skyland. Nu kör vi.',
        duration: 11000,
    },
];

/** Paus efter rösten innan nästa steg — kort andning, inget dödläge. */
const BREATH_MS = 350;
/** Fördröjning innan UI-handlingen så vybytet hinner landa visuellt. */
const ACTION_DELAY_MS = 700;

async function fetchTtsUrl(text: string): Promise<string> {
    const resp = await fetch(`${API_BASE}/voice/tts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });
    if (!resp.ok) throw new Error(`TTS ${resp.status}`);
    return URL.createObjectURL(await resp.blob());
}

function runAction(action: TourAction | undefined): void {
    if (!action) return;
    const event = action === 'open-card' ? 'scc:tour-open-card' : 'scc:tour-close-card';
    setTimeout(() => window.dispatchEvent(new CustomEvent(event)), ACTION_DELAY_MS);
}

export function GuidedTour() {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [paused, setPaused] = useState(false);
    const [narration, setNarration] = useState(true);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioStepRef = useRef<number>(-1);
    /** Förhämtade ljud-URL:er per steg — dödar tystnaden mellan stegen. */
    const ttsCacheRef = useRef<Map<number, string>>(new Map());
    const prefetchingRef = useRef<Set<number>>(new Set());

    const stopAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.onended = null;
            audioRef.current.pause();
            audioRef.current = null;
        }
    }, []);

    const clearTtsCache = useCallback(() => {
        for (const url of ttsCacheRef.current.values()) URL.revokeObjectURL(url);
        ttsCacheRef.current.clear();
        prefetchingRef.current.clear();
    }, []);

    const stop = useCallback(() => {
        setActive(false);
        setPaused(false);
        stopAudio();
        clearTtsCache();
        window.dispatchEvent(new CustomEvent('scc:tour-close-card'));
        if (timerRef.current) clearTimeout(timerRef.current);
    }, [stopAudio, clearTtsCache]);

    const goTo = useCallback((idx: number) => {
        if (idx < 0) return;
        if (idx >= TOUR_STEPS.length) { stop(); return; }
        stopAudio();
        setStep(idx);
        navigateToView(TOUR_STEPS[idx].view);
        runAction(TOUR_STEPS[idx].action);
    }, [stop, stopAudio]);

    const prefetch = useCallback((idx: number) => {
        if (idx >= TOUR_STEPS.length) return;
        if (ttsCacheRef.current.has(idx) || prefetchingRef.current.has(idx)) return;
        prefetchingRef.current.add(idx);
        const s = TOUR_STEPS[idx];
        fetchTtsUrl(`${s.title}. ${s.text}`)
            .then(url => ttsCacheRef.current.set(idx, url))
            .catch(() => { /* prefetch är best effort */ })
            .finally(() => prefetchingRef.current.delete(idx));
    }, []);

    // Start via Alex (SSE → 'scc:start-tour')
    useEffect(() => {
        const onStart = () => {
            stopAudio();
            clearTtsCache();
            setActive(true);
            setPaused(false);
            setNarration(true);
            setStep(0);
            navigateToView(TOUR_STEPS[0].view);
            runAction(TOUR_STEPS[0].action);
            prefetch(1); // ligg steget före från start
        };
        window.addEventListener('scc:start-tour', onStart);
        return () => window.removeEventListener('scc:start-tour', onStart);
    }, [stopAudio, clearTtsCache, prefetch]);

    // Framdrift: berättarröst (nästa steg när rösten tystnat) eller timer.
    useEffect(() => {
        if (!active || paused) return;
        let cancelled = false;

        const startTimer = () => {
            timerRef.current = setTimeout(() => goTo(step + 1), TOUR_STEPS[step].duration);
        };

        if (!narration) {
            startTimer();
        } else if (audioRef.current && audioStepRef.current === step) {
            // Återupptag efter paus
            void audioRef.current.play().catch(() => { setNarration(false); startTimer(); });
        } else {
            (async () => {
                try {
                    const s = TOUR_STEPS[step];
                    const url = ttsCacheRef.current.get(step) ?? await fetchTtsUrl(`${s.title}. ${s.text}`);
                    ttsCacheRef.current.set(step, url);
                    if (cancelled) return;
                    const audio = new Audio(url);
                    audioRef.current = audio;
                    audioStepRef.current = step;
                    audio.onended = () => {
                        timerRef.current = setTimeout(() => goTo(step + 1), BREATH_MS);
                    };
                    await audio.play();
                    prefetch(step + 1); // hämta nästa medan denna spelas
                } catch {
                    if (!cancelled) { setNarration(false); startTimer(); }
                }
            })();
        }

        return () => {
            cancelled = true;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [active, paused, step, narration, goTo, prefetch]);

    // Paus stoppar rösten direkt (återupptag sköts av huvudeffekten)
    useEffect(() => {
        if (paused) audioRef.current?.pause();
    }, [paused]);

    if (!active) return null;

    const current = TOUR_STEPS[step];

    const navBtn: React.CSSProperties = {
        width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    };

    return (
        <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 'calc(56px + env(safe-area-inset-bottom))',
            display: 'flex', justifyContent: 'center', zIndex: 800, pointerEvents: 'none', padding: '0 12px',
        }}>
            <AnimatePresence mode="wait">
                <motion.div
                    key={step}
                    initial={{ opacity: 0, y: 24, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -12, scale: 0.97 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    style={{
                        pointerEvents: 'auto', maxWidth: 560, width: '100%',
                        background: 'rgba(6, 20, 14, 0.92)',
                        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(16,185,129,0.25)', borderRadius: 16,
                        padding: '16px 18px 12px',
                        boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 24px rgba(16,185,129,0.08)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#10b981' }}>
                            RUNDTUR {step + 1}/{TOUR_STEPS.length}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 650, color: 'rgba(255,255,255,0.94)' }}>
                            {current.title}
                        </span>
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.72)' }}>
                        {current.text}
                    </p>

                    <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 10, overflow: 'hidden' }}>
                        {!paused && (
                            <motion.div
                                key={`bar-${step}`}
                                initial={{ width: '0%' }}
                                animate={{ width: '100%' }}
                                transition={{ duration: current.duration / 1000, ease: 'linear' }}
                                style={{ height: '100%', background: 'linear-gradient(90deg, #10b981, #34d399)' }}
                            />
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={stop} title="Avsluta rundturen" style={{ ...navBtn, color: 'rgba(255,255,255,0.5)' }}>
                            <X size={15} />
                        </button>
                        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 5 }}>
                            {TOUR_STEPS.map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => goTo(i)}
                                    title={TOUR_STEPS[i].title}
                                    style={{
                                        width: 7, height: 7, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                                        background: i === step ? '#10b981' : i < step ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.15)',
                                    }}
                                />
                            ))}
                        </div>
                        <button onClick={() => goTo(step - 1)} disabled={step === 0} title="Föregående"
                            style={{ ...navBtn, opacity: step === 0 ? 0.35 : 1 }}>
                            <ChevronLeft size={15} />
                        </button>
                        <button
                            onClick={() => { if (narration) stopAudio(); setNarration(n => !n); }}
                            title={narration ? 'Stäng av berättarrösten' : 'Slå på berättarrösten'}
                            style={{ ...navBtn, color: narration ? '#34d399' : 'rgba(255,255,255,0.4)' }}>
                            {narration ? <Volume2 size={14} /> : <VolumeX size={14} />}
                        </button>
                        <button onClick={() => setPaused(p => !p)} title={paused ? 'Fortsätt' : 'Pausa'}
                            style={{ ...navBtn, borderColor: 'rgba(16,185,129,0.35)', color: '#34d399' }}>
                            {paused ? <Play size={14} /> : <Pause size={14} />}
                        </button>
                        <button onClick={() => goTo(step + 1)} title={step === TOUR_STEPS.length - 1 ? 'Avsluta' : 'Nästa'} style={navBtn}>
                            <ChevronRight size={15} />
                        </button>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
