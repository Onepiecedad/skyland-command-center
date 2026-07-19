/**
 * GuidedTour — skriptad rundtur av hela dashboarden.
 *
 * Startas av Alex (verktyget start_ui_tour → SSE → 'scc:start-tour') eller
 * programmatiskt. Varje steg fokuserar rätt vy via navigateToView() och visar
 * ett glass-kort med förklaring. Deterministisk enligt husdoktrinen:
 * instruktioner styr ton, bara kod styr flöde — turen är identisk varje gång.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { navigateToView } from '../navigation/uiActions';
import { API_BASE } from '../api';

interface TourStep {
    view: string;
    title: string;
    text: string;
    /** Auto-advance efter så här många ms (pausbart) */
    duration: number;
}

// Texterna är skrivna för TAL, i Joakims ton: rakt, talspråk, korta meningar.
// Inga klyschor, inga tankstreck, inga parenteser eller snedstreck (TTS:en
// läser dem illa). Vill du ändra tonen är det bara att skriva om här.
const TOUR_STEPS: TourStep[] = [
    {
        view: 'alex',
        title: 'Alex',
        text: 'Det här är hemmaplan. Här snackar du med mig, Alex. Jag svarar på allt som rör CRM:et, flyttar kort, loggar svar och föreslår nästa drag. Men inget skarpt händer utan ditt godkännande. Jag föreslår, du bestämmer.',
        duration: 14000,
    },
    {
        view: 'crm',
        title: 'CRM',
        text: 'Här är själva maskinen. Varje kort är en studio som systemet hittat, berikat och poängsatt helt själv. Research med verifierade källor och ett färdigt DM-utkast, för under femtio öre per prospekt. Gör samma jobb för hand och det tar en halvtimme per studio. Dra ett kort till Contacted, så loggas meddelandet automatiskt.',
        duration: 18000,
    },
    {
        view: 'leads',
        title: 'Leads',
        text: 'Hit rinner inkommande leads, från hemsidan och röstagenten. Varje lead blir samtidigt en kontakt i CRM:et. Inget tappas mellan kanalerna.',
        duration: 12000,
    },
    {
        view: 'sequences',
        title: 'Sekvenser',
        text: 'Färdiga mejlflöden. Cold email, påminnelser inför samtal, uppföljning när någon inte dyker upp. Allt ligger bakom en kill switch, så inget skickas förrän du säger till.',
        duration: 12000,
    },
    {
        view: 'customers',
        title: 'Kunder',
        text: 'Varje kund får en egen instans med mål och spelregler. Statusen räknas fram ur det som faktiskt hänt i systemet. Den går inte att fejka.',
        duration: 12000,
    },
    {
        view: 'office',
        title: 'Kontoret',
        text: 'Här ser du teamet jobba i realtid. Researchern som gräver fram fakta, skribenten, analytikern. När en pipeline kör syns det direkt vem som gör vad.',
        duration: 13000,
    },
    {
        view: 'system',
        title: 'Systemet',
        text: 'Maskinrummet. Körningar, kostnader och varje händelse, loggat och synligt. Hände det, så syns det här. Ner på öret vad varje agent kostar.',
        duration: 13000,
    },
    {
        view: 'skills',
        title: 'Skills',
        text: 'Verktygslådan. Varje färdighet är versionshanterad kod med hårda kvalitetsgrindar, inte löften. Därför blir resultatet likadant varje gång. Det var rundturen. Nu kör vi.',
        duration: 14000,
    },
];

export function GuidedTour() {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [paused, setPaused] = useState(false);
    // Berättarröst (Alex ElevenLabs-röst via /voice/tts). På som standard;
    // faller tyst tillbaka till timer-läge om ljud inte kan spelas.
    const [narration, setNarration] = useState(true);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioStepRef = useRef<number>(-1);

    const stopAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.onended = null;
            audioRef.current.pause();
            if (audioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src);
            audioRef.current = null;
        }
    }, []);

    const stop = useCallback(() => {
        setActive(false);
        setPaused(false);
        stopAudio();
        if (timerRef.current) clearTimeout(timerRef.current);
    }, [stopAudio]);

    const goTo = useCallback((idx: number) => {
        if (idx < 0) return;
        if (idx >= TOUR_STEPS.length) { stop(); return; }
        stopAudio();
        setStep(idx);
        navigateToView(TOUR_STEPS[idx].view);
    }, [stop, stopAudio]);

    // Start via Alex (SSE → 'scc:start-tour')
    useEffect(() => {
        const onStart = () => {
            stopAudio();
            setActive(true);
            setPaused(false);
            setNarration(true);
            setStep(0);
            navigateToView(TOUR_STEPS[0].view);
        };
        window.addEventListener('scc:start-tour', onStart);
        return () => window.removeEventListener('scc:start-tour', onStart);
    }, [stopAudio]);

    // Framdrift per steg: berättarröst (nästa steg när Alex pratat klart),
    // annars timer. Ljudfel → tyst fallback till timern, turen stannar aldrig.
    useEffect(() => {
        if (!active || paused) return;
        let cancelled = false;

        const startTimer = () => {
            timerRef.current = setTimeout(() => goTo(step + 1), TOUR_STEPS[step].duration);
        };

        if (!narration) {
            startTimer();
        } else if (audioRef.current && audioStepRef.current === step) {
            // Återupptag efter paus — spela vidare där rösten stannade
            void audioRef.current.play().catch(() => { setNarration(false); startTimer(); });
        } else {
            (async () => {
                try {
                    const current = TOUR_STEPS[step];
                    const resp = await fetch(`${API_BASE}/voice/tts`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: `${current.title.replace(' — ', '. ')}. ${current.text}` }),
                    });
                    if (!resp.ok) throw new Error(`TTS ${resp.status}`);
                    const blob = await resp.blob();
                    if (cancelled) return;
                    const audio = new Audio(URL.createObjectURL(blob));
                    audioRef.current = audio;
                    audioStepRef.current = step;
                    audio.onended = () => {
                        // Kort andrum efter rösten innan nästa vy
                        timerRef.current = setTimeout(() => goTo(step + 1), 1200);
                    };
                    await audio.play();
                } catch {
                    // Autoplay blockerad eller TTS nere → timer-läge
                    if (!cancelled) { setNarration(false); startTimer(); }
                }
            })();
        }

        return () => {
            cancelled = true;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [active, paused, step, narration, goTo]);

    // Paus stoppar rösten direkt (återupptag sköts av hufvudeffekten)
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
                    transition={{ duration: 0.35, ease: 'easeOut' }}
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

                    {/* Progress för aktuellt steg */}
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
