import { useRef, useEffect, useState, type ReactNode } from 'react';

interface Segment {
    key: string;
    label: string;
    icon?: ReactNode;
}

interface Props {
    segments: Segment[];
    activeKey: string;
    onSelect: (key: string) => void;
}

export function SegmentedControl({ segments, activeKey, onSelect }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const activeIndex = segments.findIndex(s => s.key === activeKey);
        const buttons = container.querySelectorAll<HTMLButtonElement>('.seg-btn');
        const btn = buttons[activeIndex];
        if (btn) {
            setPillStyle({
                left: btn.offsetLeft,
                width: btn.offsetWidth,
            });
            // Raden rullar i sidled när flikarna inte får plats. Utan detta kan
            // den valda fliken ligga utanför skärmen utan att något visar det,
            // och pillret glider till en plats man inte ser.
            //
            // jsdom implementerar inte scrollIntoView, så ett oskyddat anrop
            // kraschar hela renderingen i testmiljön. Det sänkte CI på PR #15.
            if (typeof btn.scrollIntoView === 'function') {
                btn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [activeKey, segments]);

    // Tonad kant bara åt det håll det finns mer att hämta. Utan den ser en
    // avklippt rad ut som en rad som tagit slut — samma lösning som ScrollStrip.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const uppdatera = () => {
            el.dataset.fadeV = el.scrollLeft > 2 ? '1' : '0';
            el.dataset.fadeH = el.scrollLeft + el.clientWidth < el.scrollWidth - 2 ? '1' : '0';
        };
        uppdatera();
        el.addEventListener('scroll', uppdatera, { passive: true });
        // jsdom saknar ResizeObserver i äldre miljöer — hoppa hellre över
        // toningen än att krascha renderingen i testerna.
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(uppdatera) : null;
        ro?.observe(el);
        return () => { el.removeEventListener('scroll', uppdatera); ro?.disconnect(); };
    }, [segments]);

    return (
        <div className="segmented-control" ref={containerRef}>
            <div
                className="seg-pill"
                style={{
                    transform: `translateX(${pillStyle.left}px)`,
                    width: `${pillStyle.width}px`,
                }}
            />
            {segments.map(seg => (
                <button
                    key={seg.key}
                    className={`seg-btn ${activeKey === seg.key ? 'active' : ''}`}
                    onClick={() => onSelect(seg.key)}
                >
                    {seg.icon && <span className="seg-icon">{seg.icon}</span>}
                    {seg.label}
                </button>
            ))}
        </div>
    );
}
