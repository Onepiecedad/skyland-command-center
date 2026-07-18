/**
 * Focus Navigation Engine — "Cross Swap Navigation".
 *
 * Inte en router. Inte en meny. Ett dynamiskt kors med exakt fem vyer:
 * en i mitten (synlig) och fyra grannar (upp/höger/ner/vänster, parkerade
 * utanför skärmen åt sina respektive håll). En navigation = mitten byter
 * plats med vald granne; de tre övriga ligger stilla. Kameran flyttar fokus
 * i ett rum — den öppnar aldrig en ny sida.
 *
 * Alla fem paneler är ALLTID monterade (bevarar WebSockets, formulär, scroll).
 * Panelens transform följer dess ROLL i korset — swappen blir därmed
 * automatiskt rätt animation: nya vyn glider in från sitt håll, gamla
 * lämnar åt motsatt håll.
 *
 * Gester: piltangenter (utanför textfält) · klickbara kantpilar ·
 * minimap-klick · trackpad-swipe som börjar vid skärmkant.
 * Läget persisteras i localStorage.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './focus-nav.css';

export type Direction = 'up' | 'right' | 'down' | 'left';

export interface CrossLayout {
    center: string;
    up: string;
    right: string;
    down: string;
    left: string;
}

interface FocusNavigatorProps {
    /** Panel-innehåll per vy-nyckel (exakt 5) */
    panes: Record<string, ReactNode>;
    /** Etikett per vy-nyckel (minimap + kantpilar) */
    labels: Record<string, string>;
    defaultLayout: CrossLayout;
    storageKey?: string;
    onCenterChange?: (center: string) => void;
}

const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];

/** Panelens viloposition utifrån dess roll i korset */
const ROLE_OFFSET: Record<string, { x: string; y: string }> = {
    center: { x: '0%', y: '0%' },
    up: { x: '0%', y: '-104%' },
    down: { x: '0%', y: '104%' },
    left: { x: '-104%', y: '0%' },
    right: { x: '104%', y: '0%' },
};

function loadLayout(key: string, fallback: CrossLayout, validKeys: string[]): CrossLayout {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as CrossLayout;
        const values = [parsed.center, parsed.up, parsed.right, parsed.down, parsed.left];
        // Måste vara exakt samma 5 nycklar (en permutation) — annars fallback
        if (new Set(values).size === 5 && values.every(v => validKeys.includes(v))) return parsed;
    } catch { /* korrupt state → fallback */ }
    return fallback;
}

function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function FocusNavigator({ panes, labels, defaultLayout, storageKey = 'scc-cross-layout', onCenterChange }: FocusNavigatorProps) {
    const paneKeys = Object.keys(panes);
    const [layout, setLayout] = useState<CrossLayout>(() => loadLayout(storageKey, defaultLayout, paneKeys));
    const cooldownRef = useRef(0);
    const onCenterChangeRef = useRef(onCenterChange);
    onCenterChangeRef.current = onCenterChange;

    useEffect(() => {
        localStorage.setItem(storageKey, JSON.stringify(layout));
        onCenterChangeRef.current?.(layout.center);
    }, [layout, storageKey]);

    /** Kärnan: swap(mitten, granne i vald riktning). Inget annat rör sig. */
    const navigate = useCallback((dir: Direction) => {
        const now = Date.now();
        if (now - cooldownRef.current < 450) return; // en swap i taget
        cooldownRef.current = now;
        setLayout(prev => ({ ...prev, center: prev[dir], [dir]: prev.center }));
    }, []);

    /** Minimap/genväg: gör en specifik vy till mitten (alla icke-mitten är grannar) */
    const focusPane = useCallback((key: string) => {
        setLayout(prev => {
            if (prev.center === key) return prev;
            const dir = DIRECTIONS.find(d => prev[d] === key);
            if (!dir) return prev;
            cooldownRef.current = Date.now();
            return { ...prev, center: key, [dir]: prev.center };
        });
    }, []);

    // ── Alex (navigate_ui): fokusera en panel via CustomEvent ──
    useEffect(() => {
        const onFocusPane = (e: Event) => {
            const pane = (e as CustomEvent<{ pane: string }>).detail?.pane;
            if (pane && paneKeys.includes(pane)) focusPane(pane);
        };
        window.addEventListener('scc:focus-pane', onFocusPane);
        return () => window.removeEventListener('scc:focus-pane', onFocusPane);
    }, [focusPane, paneKeys]);

    // ── Piltangenter (när inget textfält är fokuserat) + ⌘1–⌘5 direkt till vy ──
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey) {
                const idx = parseInt(e.key, 10) - 1;
                if (idx >= 0 && idx < paneKeys.length) {
                    e.preventDefault();
                    focusPane(paneKeys[idx]);
                }
                return;
            }
            if (isTypingTarget(e.target)) return;
            const map: Record<string, Direction> = {
                ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
            };
            const dir = map[e.key];
            if (dir) { e.preventDefault(); navigate(dir); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [navigate, focusPane, paneKeys]);

    // ── Trackpad-swipe som börjar vid skärmkant (kapar ALDRIG intern scroll) ──
    useEffect(() => {
        const EDGE = 36;
        const onWheel = (e: WheelEvent) => {
            const w = window.innerWidth, h = window.innerHeight;
            const nearLeft = e.clientX < EDGE, nearRight = e.clientX > w - EDGE;
            const nearTop = e.clientY < EDGE, nearBottom = e.clientY > h - EDGE;
            if (!(nearLeft || nearRight || nearTop || nearBottom)) return;
            const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
            if (horiz && (nearLeft || nearRight) && Math.abs(e.deltaX) > 24) {
                e.preventDefault();
                navigate(e.deltaX > 0 ? 'right' : 'left');
            } else if (!horiz && (nearTop || nearBottom) && Math.abs(e.deltaY) > 24) {
                e.preventDefault();
                navigate(e.deltaY > 0 ? 'down' : 'up');
            }
        };
        window.addEventListener('wheel', onWheel, { passive: false });
        return () => window.removeEventListener('wheel', onWheel);
    }, [navigate]);

    /** Roll för en given panel-nyckel */
    const roleOf = (key: string): string => {
        if (layout.center === key) return 'center';
        return DIRECTIONS.find(d => layout[d] === key) ?? 'up';
    };

    return (
        <div className="fnav-viewport">
            {/* ── De fem panelerna — alltid monterade, transform följer rollen ── */}
            {paneKeys.map(key => {
                const role = roleOf(key);
                const offset = ROLE_OFFSET[role];
                const isCenter = role === 'center';
                return (
                    <motion.div
                        key={key}
                        className={`fnav-pane ${isCenter ? 'fnav-pane--center' : ''}`}
                        initial={false}
                        animate={{ x: offset.x, y: offset.y }}
                        transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }}
                        style={{ pointerEvents: isCenter ? 'auto' : 'none' }}
                        aria-hidden={!isCenter}
                    >
                        {panes[key]}
                    </motion.div>
                );
            })}

            {/* ── Kantpilar med grannens namn ── */}
            {DIRECTIONS.map(dir => {
                const Icon = { up: ChevronUp, right: ChevronRight, down: ChevronDown, left: ChevronLeft }[dir];
                return (
                    <button
                        key={dir}
                        className={`fnav-edge fnav-edge--${dir}`}
                        onClick={() => navigate(dir)}
                        title={`${labels[layout[dir]]} (pil ${dir === 'up' ? 'upp' : dir === 'down' ? 'ner' : dir === 'left' ? 'vänster' : 'höger'})`}
                    >
                        <Icon size={14} />
                        <span>{labels[layout[dir]]}</span>
                    </button>
                );
            })}

            {/* ── Minimap: korset i miniatyr, klickbart ── */}
            <div className="fnav-minimap" aria-label="Navigationskors">
                <div />
                <button className="fnav-mini" onClick={() => navigate('up')}>{labels[layout.up]}</button>
                <div />
                <button className="fnav-mini" onClick={() => navigate('left')}>{labels[layout.left]}</button>
                <button className="fnav-mini fnav-mini--center" onClick={() => { /* redan i fokus */ }}>{labels[layout.center]}</button>
                <button className="fnav-mini" onClick={() => navigate('right')}>{labels[layout.right]}</button>
                <div />
                <button className="fnav-mini" onClick={() => navigate('down')}>{labels[layout.down]}</button>
                <div />
            </div>
        </div>
    );
}
