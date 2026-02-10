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
        }
    }, [activeKey, segments]);

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
