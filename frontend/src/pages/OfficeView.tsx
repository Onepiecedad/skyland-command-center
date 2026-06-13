import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStatus } from '../gateway/fleetApi';

// ─── Static office layout: main in the centre, 8 sub-agents around it ───
const MAIN = { x: 500, y: 360 };

interface Desk {
    id: string;          // agent id (matched against session key segment)
    name: string;
    cluster: string;
    x: number;
    y: number;
}

// Ring of 8 desks around main, grouped by role-adjacency.
const DESKS: Desk[] = [
    { id: 'orchestrator', name: 'Orchestrator', cluster: 'Koordinering', x: 500, y: 110 },
    { id: 'researcher', name: 'Researcher', cluster: 'Research', x: 770, y: 200 },
    { id: 'research-librarian', name: 'Research-librarian', cluster: 'Research', x: 840, y: 360 },
    { id: 'analyst', name: 'Analyst', cluster: 'Analys', x: 770, y: 520 },
    { id: 'strategy-analyst', name: 'Strategy-analyst', cluster: 'Analys', x: 500, y: 610 },
    { id: 'writer', name: 'Writer', cluster: 'Copy', x: 230, y: 520 },
    { id: 'dm-writer', name: 'DM-writer', cluster: 'Copy', x: 160, y: 360 },
    { id: 'lyra', name: 'Lyra', cluster: 'Prompt', x: 230, y: 200 },
];

const STATUS_COLOR: Record<AgentStatus, string> = {
    active: '#22c55e',
    waiting: '#f59e0b',
    idle: '#475569',
    error: '#ef4444',
};
const STATUS_LABEL: Record<AgentStatus, string> = {
    active: 'Jobbar',
    waiting: 'Väntar',
    idle: 'Ledig',
    error: 'Fel',
};

interface DeskState {
    status: AgentStatus;
    task: string;
}

interface Envelope {
    id: number;
    deskId: string;
    dir: 'out' | 'back'; // out = main→desk, back = desk→main
}



export default function OfficeView() {
    const [desks, setDesks] = useState<Record<string, DeskState>>({});
    const [mainState, setMainState] = useState<DeskState>({ status: 'idle', task: '' });
    const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
    const [connected, setConnected] = useState(true);
    const prevRef = useRef<Record<string, AgentStatus>>({});
    const envIdRef = useRef(0);

    const fireEnvelope = useCallback((deskId: string, dir: 'out' | 'back') => {
        const id = ++envIdRef.current;
        setEnvelopes((e) => [...e, { id, deskId, dir }]);
        setTimeout(() => setEnvelopes((e) => e.filter((x) => x.id !== id)), 1600);
    }, []);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/v1/agents/office');
            if (!res.ok) throw new Error('bad response');
            const data = await res.json();
            setConnected(true);

            const byId: Record<string, { status: AgentStatus; task: string }> = {};
            for (const a of (data.agents || [])) {
                byId[a.id] = { status: a.status as AgentStatus, task: a.task || '' };
            }

            // Main
            const main = byId['main'];
            setMainState({ status: main?.status ?? 'idle', task: main?.task ?? '' });

            // Desks + transition detection (envelope animations)
            const next: Record<string, DeskState> = {};
            for (const d of DESKS) {
                const a = byId[d.id];
                const status = a?.status ?? 'idle';
                next[d.id] = { status, task: a?.task ?? '' };

                const prevStatus = prevRef.current[d.id] ?? 'idle';
                if (prevStatus !== 'active' && status === 'active') fireEnvelope(d.id, 'out');
                else if (prevStatus === 'active' && status !== 'active') fireEnvelope(d.id, 'back');
                prevRef.current[d.id] = status;
            }
            setDesks(next);
        } catch {
            setConnected(false);
        }
    }, [fireEnvelope]);

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 3000);
        return () => clearInterval(t);
    }, [refresh]);

    const activeCount = Object.values(desks).filter((d) => d.status === 'active').length;

    const trunc = (s: string, n = 38) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

    const renderDesk = (d: Desk) => {
        const st = desks[d.id] ?? { status: 'idle' as AgentStatus, task: '' };
        const color = STATUS_COLOR[st.status];
        const w = 168, h = 66;
        const x = d.x - w / 2, y = d.y - h / 2;
        const active = st.status === 'active';
        return (
            <g key={d.id}>
                <rect
                    x={x} y={y} width={w} height={h} rx={10}
                    fill="rgba(15,23,42,0.92)"
                    stroke={active ? color : 'rgba(148,163,184,0.25)'}
                    strokeWidth={active ? 2 : 1}
                    style={active ? { filter: `drop-shadow(0 0 8px ${color})` } : undefined}
                />
                <circle cx={x + 14} cy={y + 15} r={5} fill={color}>
                    {active && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
                </circle>
                <text x={x + 26} y={y + 19} fill="#e2e8f0" fontSize={13} fontWeight={600}>{d.name}</text>
                <text x={x + 12} y={y + 37} fill="#64748b" fontSize={10} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{d.cluster}</text>
                <text x={x + 12} y={y + 55} fill={active ? '#cbd5e1' : '#475569'} fontSize={10.5}>
                    {active ? trunc(st.task || 'Arbetar…') : STATUS_LABEL[st.status]}
                </text>
            </g>
        );
    };

    return (
        <div className="office-view" style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px 12px' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>🏢 Kontoret</h2>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                        Main delegerar · subagenter utför · resultat tillbaka — i realtid
                    </p>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 14 }}>
                    <span>{connected ? '🟢 Gateway' : '🔴 Offline'}</span>
                    <span>{activeCount} aktiva nu</span>
                </div>
            </div>

            <svg viewBox="0 0 1000 720" style={{ width: '100%', height: 'calc(100% - 56px)' }}>
                {/* connection lines main ↔ desk */}
                {DESKS.map((d) => {
                    const st = desks[d.id]?.status ?? 'idle';
                    const active = st === 'active';
                    return (
                        <line key={`l-${d.id}`} x1={MAIN.x} y1={MAIN.y} x2={d.x} y2={d.y}
                            stroke={active ? STATUS_COLOR.active : 'rgba(100,116,139,0.18)'}
                            strokeWidth={active ? 2 : 1}
                            strokeDasharray={active ? '0' : '4 6'} />
                    );
                })}

                {/* travelling envelopes */}
                <AnimatePresence>
                    {envelopes.map((env) => {
                        const d = DESKS.find((x) => x.id === env.deskId)!;
                        const from = env.dir === 'out' ? MAIN : d;
                        const to = env.dir === 'out' ? d : MAIN;
                        return (
                            <motion.g key={env.id}
                                initial={{ x: from.x, y: from.y, opacity: 0 }}
                                animate={{ x: to.x, y: to.y, opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 1.4, ease: 'easeInOut' }}>
                                <circle r={9} fill={env.dir === 'out' ? '#38bdf8' : '#22c55e'}
                                    style={{ filter: 'drop-shadow(0 0 6px currentColor)' }} />
                                <text x={-5} y={4} fontSize={11}>{env.dir === 'out' ? '📋' : '✓'}</text>
                            </motion.g>
                        );
                    })}
                </AnimatePresence>

                {/* sub-agent desks */}
                {DESKS.map(renderDesk)}

                {/* main desk (centre) */}
                <g>
                    <rect x={MAIN.x - 110} y={MAIN.y - 50} width={220} height={100} rx={14}
                        fill="rgba(2,6,23,0.95)"
                        stroke={mainState.status === 'active' ? STATUS_COLOR.active : '#6366f1'}
                        strokeWidth={2}
                        style={{ filter: `drop-shadow(0 0 14px ${mainState.status === 'active' ? '#22c55e' : '#6366f1'})` }} />
                    <text x={MAIN.x} y={MAIN.y - 18} textAnchor="middle" fill="#a5b4fc" fontSize={15} fontWeight={700}>⚡ Main · Alex</text>
                    <text x={MAIN.x} y={MAIN.y + 2} textAnchor="middle" fill="#64748b" fontSize={10} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Koordinator</text>
                    <text x={MAIN.x} y={MAIN.y + 26} textAnchor="middle" fill="#cbd5e1" fontSize={11}>
                        {mainState.status === 'active' ? trunc(mainState.task || 'Arbetar…', 30) : 'Redo'}
                    </text>
                </g>
            </svg>
        </div>
    );
}
