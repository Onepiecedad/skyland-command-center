/**
 * IntroSequence — cinematisk post-login-intro (Marvel Studios-inspirerad).
 * Fas 1: ljussvep över svart. Fas 2: loggan laddas upp med glow-puls.
 * Fas 3: SKYLAND breddas ut, COMMAND CENTER tonas in. Fas 4: släpp in i appen.
 * Total ~3,2s. Rendera ovanpå appen så den ligger färdig bakom när ridån lyfts.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GREEN = '#10b981';

export function IntroSequence({ onDone }: { onDone: () => void }) {
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        const t1 = setTimeout(() => setLeaving(true), 2800);
        const t2 = setTimeout(onDone, 3400);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [onDone]);

    return (
        <AnimatePresence>
            {!leaving && (
                <motion.div
                    key="intro"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 9999,
                        background: 'radial-gradient(ellipse at center, #061410 0%, #020705 70%, #000 100%)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                    }}
                >
                    {/* Ljussvep — tunn grön horisontlinje som drar över skärmen */}
                    <motion.div
                        initial={{ x: '-110vw', opacity: 0 }}
                        animate={{ x: '110vw', opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 1.1, ease: 'easeInOut', times: [0, 0.15, 0.85, 1] }}
                        style={{
                            position: 'absolute', top: '50%', left: 0, width: '60vw', height: 2,
                            background: `linear-gradient(90deg, transparent, ${GREEN}, transparent)`,
                            boxShadow: `0 0 24px 4px rgba(16,185,129,0.55)`,
                        }}
                    />

                    {/* Energi-burst bakom loggan */}
                    <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0, 2.6, 3.4], opacity: [0, 0.5, 0] }}
                        transition={{ delay: 0.7, duration: 1.4, ease: 'easeOut' }}
                        style={{
                            position: 'absolute', width: 340, height: 340, borderRadius: '50%',
                            background: `radial-gradient(circle, rgba(16,185,129,0.35) 0%, transparent 65%)`,
                        }}
                    />

                    {/* Loggan — zoomar in med flash och landar med puls */}
                    <motion.img
                        src="/logo-full.png"
                        alt=""
                        initial={{ scale: 0.4, opacity: 0, filter: 'brightness(3) blur(10px)' }}
                        animate={{
                            scale: [0.4, 1.06, 1],
                            opacity: [0, 1, 1],
                            filter: [
                                'brightness(3) blur(10px)',
                                'brightness(1.6) blur(0px) drop-shadow(0 0 42px rgba(16,185,129,0.8))',
                                'brightness(1) blur(0px) drop-shadow(0 0 18px rgba(16,185,129,0.45))',
                            ],
                        }}
                        transition={{ delay: 0.55, duration: 1.25, ease: [0.16, 1, 0.3, 1], times: [0, 0.6, 1] }}
                        style={{ width: 300, height: 300, objectFit: 'cover', objectPosition: '50% 26%', mixBlendMode: 'screen' }}
                    />

                    {/* SKYLAND — bokstäverna breddas ut ur mitten */}
                    <motion.div
                        initial={{ opacity: 0, letterSpacing: '0.02em', y: 12 }}
                        animate={{ opacity: 1, letterSpacing: '0.42em', y: 0 }}
                        transition={{ delay: 1.35, duration: 0.9, ease: 'easeOut' }}
                        style={{
                            marginTop: 26, fontSize: 34, fontWeight: 800, color: '#eafff5',
                            textShadow: `0 0 28px rgba(16,185,129,0.6)`,
                            fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
                            paddingLeft: '0.42em', // kompensera letter-spacing-obalansen
                        }}
                    >
                        SKYLAND
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.65 }}
                        transition={{ delay: 1.9, duration: 0.6 }}
                        style={{
                            marginTop: 8, fontSize: 12, fontWeight: 600, letterSpacing: '0.55em',
                            paddingLeft: '0.55em', color: GREEN, textTransform: 'uppercase',
                        }}
                    >
                        Command Center
                    </motion.div>

                    {/* Bottenlinje som "laddar klart" */}
                    <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: 1.5, duration: 1.1, ease: 'easeInOut' }}
                        style={{
                            marginTop: 30, width: 240, height: 1.5, transformOrigin: 'center',
                            background: `linear-gradient(90deg, transparent, ${GREEN}, transparent)`,
                        }}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
