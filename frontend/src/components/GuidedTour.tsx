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
import { X, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { navigateToView } from '../navigation/uiActions';

interface TourStep {
    view: string;
    title: string;
    text: string;
    /** Auto-advance efter så här många ms (pausbart) */
    duration: number;
}

const TOUR_STEPS: TourStep[] = [
    {
        view: 'alex',
        title: 'Alex — kommandocentralen',
        text: 'Här pratar du med Alex, systemets hjärna. Alex svarar på frågor om allt i CRM:et, flyttar kort, loggar interaktioner och föreslår åtgärder. Allt som påverkar en kund kräver ditt godkännande — Alex föreslår, du bestämmer.',
        duration: 14000,
    },
    {
        view: 'crm',
        title: 'CRM — prospekteringsmaskinen',
        text: 'Kanban-pipelinen med alla prospekt. Varje kort är automatiskt hittat, berikat och poängsatt (tier A/B/C), med AI-research och personligt DM-utkast — allt för under 50 öre per prospekt. Dra ett kort till Contacted så loggas meddelandet automatiskt i konversationshistoriken.',
        duration: 18000,
    },
    {
        view: 'leads',
        title: 'Leads — inflödet',
        text: 'Inkommande leads från hemsidan och röstagenten landar här via automatiska flöden. Varje lead blir samtidigt en kontakt i CRM:et, så inget tappas bort mellan kanalerna.',
        duration: 12000,
    },
    {
        view: 'sequences',
        title: 'Sekvenser — automatiska flöden',
        text: 'Fördefinierade mejlflöden: cold email-drip, påminnelser inför strategisamtal, no-show-uppföljning. Utskick skyddas av en global kill switch — inget går ut förrän den är på.',
        duration: 12000,
    },
    {
        view: 'customers',
        title: 'Kunder — instanserna',
        text: 'Varje kund har en egen instans med charter, mål och guardrails. Statusen (aktiv/varning/fel) härleds automatiskt från verklig aktivitet — den kan aldrig fejkas manuellt.',
        duration: 12000,
    },
    {
        view: 'office',
        title: 'Kontoret — agentteamet',
        text: 'Här ser du AI-agenterna i realtid: researcher som gräver fram verifierade fakta, writer, analyst med flera. När en pipeline kör syns arbetet live — vem som jobbar, med vad.',
        duration: 13000,
    },
    {
        view: 'system',
        title: 'Systemöversikt — maskinrummet',
        text: 'Körningar, kostnader, aktivitetslogg och eventström. Allt som händer i systemet loggas och är synligt här — om det hände så syns det. Kostnadsspårning per agent och modell ingår.',
        duration: 13000,
    },
    {
        view: 'skills',
        title: 'Skills — verktygslådan',
        text: 'Agenternas färdigheter: prospektering, research, DM-generering med hårda kvalitetsgrindar. Varje skill är versionshanterad kod — inte löften. Det är därför resultatet blir likadant varje gång. Det var hela rundturen!',
        duration: 14000,
    },
];

export function GuidedTour() {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [paused, setPaused] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const stop = useCallback(() => {
        setActive(false);
        setPaused(false);
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const goTo = useCallback((idx: number) => {
        if (idx < 0) return;
        if (idx >= TOUR_STEPS.length) { stop(); return; }
        setStep(idx);
        navigateToView(TOUR_STEPS[idx].view);
    }, [stop]);

    // Start via Alex (SSE → 'scc:start-tour')
    useEffect(() => {
        const onStart = () => {
            setActive(true);
            setPaused(false);
            setStep(0);
            navigateToView(TOUR_STEPS[0].view);
        };
        window.addEventListener('scc:start-tour', onStart);
        return () => window.removeEventListener('scc:start-tour', onStart);
    }, []);

    // Auto-advance (pausbart)
    useEffect(() => {
        if (!active || paused) return;
        timerRef.current = setTimeout(() => goTo(step + 1), TOUR_STEPS[step].duration);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [active, paused, step, goTo]);

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
