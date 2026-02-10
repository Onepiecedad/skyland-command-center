import { useMemo, useState, useRef, useEffect } from 'react';
import { Brain, ChevronDown, ChevronRight, Zap, Search, Wrench, Send } from 'lucide-react';

const MODULE_LOAD_TIME = Date.now();

// ─── Types ───

type ReasoningCategory = 'analysis' | 'decision' | 'execution' | 'delegation';

interface ReasoningEntry {
    id: string;
    category: ReasoningCategory;
    title: string;
    detail: string;
    timestamp: string;
}

// ─── Config ───

const CATEGORY_CONFIG: Record<ReasoningCategory, { icon: React.ReactNode; label: string; color: string }> = {
    analysis: { icon: <Search size={14} />, label: 'Analys', color: '#8B5CF6' },
    decision: { icon: <Zap size={14} />, label: 'Beslut', color: '#EC4899' },
    execution: { icon: <Wrench size={14} />, label: 'Exekvering', color: '#06B6D4' },
    delegation: { icon: <Send size={14} />, label: 'Delegering', color: '#F59E0B' },
};

// ─── Block Sub-component ───

function ReasoningBlock({ entry }: { entry: ReasoningEntry }) {
    const [expanded, setExpanded] = useState(false);
    const cfg = CATEGORY_CONFIG[entry.category];

    return (
        <div className={`reasoning-block category-${entry.category}`}>
            <button
                className="reasoning-block-header"
                onClick={() => setExpanded(!expanded)}
                type="button"
            >
                <div className="reasoning-block-indicator" />
                <span className="reasoning-block-icon">{cfg.icon}</span>
                <div className="reasoning-block-meta">
                    <span className="reasoning-block-label">{cfg.label}</span>
                    <span className="reasoning-block-title">{entry.title}</span>
                </div>
                <span className="reasoning-block-time">{entry.timestamp}</span>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {expanded && (
                <div className="reasoning-block-detail">
                    <p>{entry.detail}</p>
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───

interface ReasoningStreamProps {
    messages?: { role: string; content: string }[];
    alexState?: string;
    isStreaming?: boolean;
}

function categorizeMessage(content: string): ReasoningCategory {
    const lower = content.toLowerCase();
    if (lower.includes('delegat') || lower.includes('skicka till') || lower.includes('agent:')) return 'delegation';
    if (lower.includes('beslut') || lower.includes('vält') || lower.includes('strategi')) return 'decision';
    if (lower.includes('kör') || lower.includes('exekver') || lower.includes('implement')) return 'execution';
    return 'analysis';
}

export default function ReasoningStream({ messages = [], alexState, isStreaming }: ReasoningStreamProps) {
    const timelineRef = useRef<HTMLDivElement>(null);

    const entries = useMemo<ReasoningEntry[]>(() => {
        const now = MODULE_LOAD_TIME;
        const assistantMsgs = messages
            .filter(m => m.role === 'assistant' && m.content)
            .slice(-15);

        return assistantMsgs.map((msg, i) => {
            const category = categorizeMessage(msg.content);
            const title = msg.content.slice(0, 60) + (msg.content.length > 60 ? '…' : '');
            return {
                id: `reasoning-${i}`,
                category,
                title,
                detail: msg.content,
                timestamp: new Date(now - (assistantMsgs.length - i) * 30000)
                    .toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
            };
        });
    }, [messages]);

    // Auto-scroll to latest entry
    useEffect(() => {
        if (timelineRef.current) {
            timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
        }
    }, [entries.length]);

    const stateLabel = alexState === 'thinking' ? 'Tänker…' : alexState === 'executing' ? 'Exekverar…' : alexState === 'idle' ? 'Redo' : '';

    return (
        <section className="reasoning-stream">
            <div className={`reasoning-stream-header ${isStreaming ? 'streaming' : ''}`}>
                <Brain size={20} />
                <h2>Alex Tankeprocess</h2>
                {(alexState || isStreaming) && (
                    <span className={`reasoning-stream-state ${isStreaming ? 'pulse' : ''}`}>
                        {isStreaming ? '● Live' : stateLabel}
                    </span>
                )}
            </div>

            <div className="reasoning-stream-timeline" ref={timelineRef}>
                {entries.length === 0 ? (
                    <div className="reasoning-stream-empty">
                        <Brain size={28} />
                        <p>Ingen tankeaktivitet ännu</p>
                        <span>Skicka ett meddelande till Alex för att se resonemang</span>
                    </div>
                ) : (
                    entries.map(entry => (
                        <ReasoningBlock key={entry.id} entry={entry} />
                    ))
                )}
            </div>
        </section>
    );
}
