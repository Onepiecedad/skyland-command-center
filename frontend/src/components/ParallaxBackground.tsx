import { useEffect, useRef } from 'react';

/**
 * ParallaxBackground — Animated deep-space background
 * Three layers: static stars, drifting nebula clouds, floating particles
 * All GPU-accelerated via CSS transforms + will-change
 */
export function ParallaxBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animId: number;
        let stars: Array<{ x: number; y: number; r: number; speed: number; alpha: number }> = [];
        let particles: Array<{ x: number; y: number; r: number; speed: number; angle: number; alpha: number; hue: number }> = [];

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            init();
        };

        const init = () => {
            const w = canvas.width;
            const h = canvas.height;

            // Background stars — small, slow, white
            stars = Array.from({ length: 200 }, () => ({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 1.2 + 0.3,
                speed: Math.random() * 0.15 + 0.02,
                alpha: Math.random() * 0.6 + 0.2,
            }));

            // Floating particles — colored, drifting
            particles = Array.from({ length: 40 }, () => ({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 2 + 0.8,
                speed: Math.random() * 0.4 + 0.1,
                angle: Math.random() * Math.PI * 2,
                alpha: Math.random() * 0.3 + 0.1,
                hue: [200, 260, 170, 300][Math.floor(Math.random() * 4)], // blue, purple, teal, magenta
            }));
        };

        const draw = () => {
            const w = canvas.width;
            const h = canvas.height;

            // Clear
            ctx.clearRect(0, 0, w, h);

            // Draw stars
            for (const s of stars) {
                s.y += s.speed;
                if (s.y > h) { s.y = -2; s.x = Math.random() * w; }

                // Twinkle
                const twinkle = 0.5 + 0.5 * Math.sin(Date.now() * 0.001 * s.speed + s.x);
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha * twinkle})`;
                ctx.fill();
            }

            // Draw floating particles with glow
            for (const p of particles) {
                p.x += Math.cos(p.angle) * p.speed;
                p.y += Math.sin(p.angle) * p.speed;
                p.angle += (Math.random() - 0.5) * 0.02;

                // Wrap around
                if (p.x < -20) p.x = w + 20;
                if (p.x > w + 20) p.x = -20;
                if (p.y < -20) p.y = h + 20;
                if (p.y > h + 20) p.y = -20;

                // Glow
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
                gradient.addColorStop(0, `hsla(${p.hue}, 80%, 65%, ${p.alpha})`);
                gradient.addColorStop(1, `hsla(${p.hue}, 80%, 65%, 0)`);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
                ctx.fillStyle = gradient;
                ctx.fill();

                // Core
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue}, 80%, 75%, ${p.alpha * 2})`;
                ctx.fill();
            }

            animId = requestAnimationFrame(draw);
        };

        resize();
        draw();
        window.addEventListener('resize', resize);

        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return (
        <>
            {/* Deep space gradient base */}
            <div className="parallax-base" aria-hidden="true" />
            {/* Animated canvas */}
            <canvas ref={canvasRef} className="parallax-canvas" aria-hidden="true" />
            {/* Nebula layers */}
            <div className="parallax-nebula parallax-nebula-1" aria-hidden="true" />
            <div className="parallax-nebula parallax-nebula-2" aria-hidden="true" />
        </>
    );
}
