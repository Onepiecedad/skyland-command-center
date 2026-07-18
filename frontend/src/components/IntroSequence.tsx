/**
 * IntroSequence — cinematisk post-login-intro (Marvel Studios-inspirerad).
 * Fas 1: ljussvep över svart. Fas 2: loggan laddas upp med glow-puls.
 * Fas 3: SKYLAND breddas ut, COMMAND CENTER tonas in. Fas 4: släpp in i appen.
 * Total ~3,2s. Rendera ovanpå appen så den ligger färdig bakom när ridån lyfts.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GREEN = '#10b981';

/**
 * Syntetiserad ljudsignatur, synkad mot animationens tidslinje:
 *  0.0–1.1s  riser (brusfilter-svep) under ljuslinjen
 *  1.1s      bas-impact + kristallping när loggan flashar
 *  1.4–3.2s  mjukt skimmer-ackord under SKYLAND-breddningen
 *  2.6–3.3s  allt tonar ut med ridån
 * Ljud är grädde — får aldrig krascha intron (try/catch, autoplay-safe).
 */
function playIntroSound() {
    try {
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume();
        const t0 = ctx.currentTime;

        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, t0);
        master.gain.exponentialRampToValueAtTime(0.3, t0 + 0.15);
        master.gain.setValueAtTime(0.3, t0 + 2.6);
        master.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.3);
        master.connect(ctx.destination);

        // 1) Riser — vitt brus genom stigande bandpass, följer ljussvepet
        const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.3), ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 2;
        bp.frequency.setValueAtTime(150, t0);
        bp.frequency.exponentialRampToValueAtTime(2400, t0 + 1.1);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t0);
        ng.gain.exponentialRampToValueAtTime(0.5, t0 + 0.95);
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
        noise.connect(bp).connect(ng).connect(master);
        noise.start(t0);
        noise.stop(t0 + 1.3);

        // 2) Bas-impact när loggan landar med flash (~1.1s)
        const boomT = t0 + 1.1;
        const boom = ctx.createOscillator();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(120, boomT);
        boom.frequency.exponentialRampToValueAtTime(38, boomT + 0.5);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, boomT);
        bg.gain.exponentialRampToValueAtTime(0.9, boomT + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.0001, boomT + 0.9);
        boom.connect(bg).connect(master);
        boom.start(boomT);
        boom.stop(boomT + 1);

        // 3) Kristallping ovanpå flashen
        const ping = ctx.createOscillator();
        ping.type = 'sine';
        ping.frequency.setValueAtTime(1568, boomT);
        ping.frequency.exponentialRampToValueAtTime(784, boomT + 0.6);
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, boomT);
        pg.gain.exponentialRampToValueAtTime(0.18, boomT + 0.02);
        pg.gain.exponentialRampToValueAtTime(0.0001, boomT + 0.8);
        ping.connect(pg).connect(master);
        ping.start(boomT);
        ping.stop(boomT + 0.9);

        // 4) Skimmer-ackord (A-dur-färg) under textbreddningen
        const padT = t0 + 1.4;
        [220, 277.18, 329.63].forEach((f, i) => {
            const o = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.value = f;
            o.detune.value = i * 4;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, padT);
            g.gain.exponentialRampToValueAtTime(0.08, padT + 0.5);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);
            o.connect(g).connect(master);
            o.start(padT);
            o.stop(t0 + 3.3);
        });

        setTimeout(() => void ctx.close(), 4000);
    } catch {
        // tyst — intron rullar ändå
    }
}

export function IntroSequence({ onDone }: { onDone: () => void }) {
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        playIntroSound();
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
