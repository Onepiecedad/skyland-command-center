import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchWithAuth } from '../api';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStatus } from '../gateway/fleetApi';
import { getGatewaySocket, type GatewaySession } from '../gateway/gatewaySocket';
import { AGENT_PROFILES } from '../data/agentProfiles';
import { CharacterSheet, type AgentLiveInfo } from '../components/CharacterSheet';

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

interface ActivityItem {
    key: string;
    label: string;
    when?: string;
    tokens?: number;
    costUsd?: number;
    preview: string;
}

function timeAgo(iso?: string): string {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(mins) || mins < 0) return '';
    if (mins < 1) return 'nyss';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

/** Matcha en gateway-session mot ett skrivbord — exakt via agentId (nyckelformat: agent:<id>:...). */
function deskIdForSession(s: GatewaySession): string | null {
    const aid = s.agentId || s.key.split(':')[1] || '';
    return DESKS.some(d => d.id === aid) ? aid : null;
}

export default function OfficeView() {
    const [desks, setDesks] = useState<Record<string, DeskState>>({});
    const [mainState, setMainState] = useState<DeskState>({ status: 'idle', task: '' });
    const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
    const [connected, setConnected] = useState(true);
    const [activity, setActivity] = useState<ActivityItem[]>([]);
    const [sheetAgent, setSheetAgent] = useState<string | null>(null);
    const [liveInfo, setLiveInfo] = useState<Record<string, AgentLiveInfo>>({});
    const prevRef = useRef<Record<string, AgentStatus>>({});
    const envIdRef = useRef(0);

    const fireEnvelope = useCallback((deskId: string, dir: 'out' | 'back') => {
        const id = ++envIdRef.current;
        setEnvelopes((e) => [...e, { id, deskId, dir }]);
        setTimeout(() => setEnvelopes((e) => e.filter((x) => x.id !== id)), 1600);
    }, []);

    const applyStatuses = useCallback((next: Record<string, DeskState>) => {
        for (const d of DESKS) {
            const status = next[d.id]?.status ?? 'idle';
            const prevStatus = prevRef.current[d.id] ?? 'idle';
            if (prevStatus !== 'active' && status === 'active') fireEnvelope(d.id, 'out');
            else if (prevStatus === 'active' && status !== 'active') fireEnvelope(d.id, 'back');
            prevRef.current[d.id] = status;
        }
        setDesks(next);
    }, [fireEnvelope]);

    // ── Källa 1: gatewayn direkt från webbläsaren (funkar på live-sidan) ──
    const refreshGateway = useCallback(async (): Promise<boolean> => {
        try {
            const socket = getGatewaySocket();
            if (!socket.connected) return false;

            // Hämta ALLA agenters sessioner (utan agentId-filter). Faller gatewayn
            // tillbaka till bara main: fråga per skrivbord.
            let sessions = await socket.getSessions();
            const seenAgents = new Set(sessions.map(s => s.agentId ?? s.key.split(':')[1]));
            if (seenAgents.size <= 1) {
                const per = await Promise.all(DESKS.map(d => socket.getSessions(d.id).catch(() => [])));
                sessions = [...sessions, ...per.flat()];
            }

            const HEARTBEAT_NOISE = /HEARTBEAT|NO_REPLY|heartbeat check|Checking in —/i;
            const relevant = sessions.filter(s => !s.key.endsWith(':heartbeat'));
            // Roll-agenternas sessioner + mains anonyma sub-agent-spawns
            const roleSess = relevant.filter(s => deskIdForSession(s) !== null);
            const anonSubs = relevant.filter(s => (s.key.split(':')[2] || '') === 'subagent');
            const feedSource = [...roleSess, ...anonSubs];
            const mainSess = relevant.find(s => s.key === 'agent:main:main');

            // Aktivitetsfeed: senaste körningarna med preview
            const recent = [...feedSource]
                .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
                .slice(0, 8);
            const items: ActivityItem[] = await Promise.all(recent.map(async (s) => {
                let preview = '';
                try {
                    const h = await socket.getChatHistory(s.key, 5);
                    const withText = (h.messages || []).filter(m =>
                        (m.content || '').trim() && !HEARTBEAT_NOISE.test(m.content || ''));
                    preview = withText[withText.length - 1]?.content?.slice(0, 110) ?? '';
                } catch { /* best effort */ }
                const deskId = deskIdForSession(s);
                const deskName = deskId ? DESKS.find(d => d.id === deskId)?.name : undefined;
                return {
                    key: s.key,
                    label: deskName || s.label || `Alex · sub-agent ${s.key.split(':')[3]?.slice(0, 6) ?? ''}`,
                    when: s.lastMessageAt,
                    tokens: s.tokenCount,
                    costUsd: s.costUsd,
                    preview,
                };
            }));
            setActivity(items);

            // Tänd skrivbord vars agent har färsk session (< 3 min)
            const nowMs = Date.now();
            const next: Record<string, DeskState> = {};
            const live: Record<string, AgentLiveInfo> = {};
            for (const d of DESKS) {
                const sess = roleSess.filter(s => deskIdForSession(s) === d.id)
                    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))[0];
                const fresh = !!(sess?.lastMessageAt && nowMs - new Date(sess.lastMessageAt).getTime() < 3 * 60_000);
                const status: AgentStatus = fresh ? 'active' : 'idle';
                next[d.id] = { status, task: fresh ? (sess?.label || 'Arbetar…') : '' };
                live[d.id] = {
                    status: STATUS_LABEL[status],
                    lastActivity: sess?.lastMessageAt,
                    tokenCount: sess?.tokenCount,
                    lastMessage: items.find(i => i.key === sess?.key)?.preview,
                };
            }
            // Kloner (subagent-kanalen) räknas som MAINS aktivitet — utan detta ser
            // kontoret dött ut när Alex kör jobb i egna kloner istället för specialister.
            const freshClones = anonSubs.filter(s =>
                s.lastMessageAt && nowMs - new Date(s.lastMessageAt).getTime() < 3 * 60_000);
            const mainFresh = !!(mainSess?.lastMessageAt && nowMs - new Date(mainSess.lastMessageAt).getTime() < 2 * 60_000)
                || freshClones.length > 0;
            setMainState({
                status: mainFresh ? 'active' : 'idle',
                task: freshClones.length > 0
                    ? `${freshClones.length} klon${freshClones.length > 1 ? 'er' : ''} igång`
                    : mainFresh ? 'I konversation' : '',
            });
            live['main'] = {
                status: mainFresh ? 'Jobbar' : 'Redo',
                lastActivity: mainSess?.lastMessageAt,
                tokenCount: mainSess?.tokenCount,
            };
            setLiveInfo(live);
            applyStatuses(next);
            return true;
        } catch {
            return false;
        }
    }, [applyStatuses]);

    // ── Källa 2 (fallback): backend-office (funkar när backend når gatewayn) ──
    const refreshBackend = useCallback(async (): Promise<boolean> => {
        try {
            const res = await fetchWithAuth('/api/v1/agents/office');
            if (!res.ok) throw new Error('bad response');
            const data = await res.json();

            const byId: Record<string, { status: AgentStatus; task: string }> = {};
            for (const a of (data.agents || [])) {
                byId[a.id] = { status: a.status as AgentStatus, task: a.task || '' };
            }

            const main = byId['main'];
            setMainState({ status: main?.status ?? 'idle', task: main?.task ?? '' });

            const next: Record<string, DeskState> = {};
            for (const d of DESKS) {
                const a = byId[d.id];
                next[d.id] = { status: a?.status ?? 'idle', task: a?.task ?? '' };
            }
            applyStatuses(next);
            return true;
        } catch {
            return false;
        }
    }, [applyStatuses]);

    useEffect(() => {
        let stop = false;
        const tick = async () => {
            const gwOk = await refreshGateway();
            const ok = gwOk || await refreshBackend();
            if (!stop) setConnected(ok);
        };
        tick();
        const t = setInterval(tick, 5000);
        return () => { stop = true; clearInterval(t); };
    }, [refreshGateway, refreshBackend]);

    // Esc stänger rollformuläret
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetAgent(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const activeCount = Object.values(desks).filter((d) => d.status === 'active').length
        + (mainState.status === 'active' ? 1 : 0);

    const trunc = (s: string, n = 38) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

    const renderDesk = (d: Desk) => {
        const st = desks[d.id] ?? { status: 'idle' as AgentStatus, task: '' };
        const color = STATUS_COLOR[st.status];
        const w = 190, h = 72;
        const x = d.x - w / 2, y = d.y - h / 2;
        const active = st.status === 'active';
        const avatar = AGENT_PROFILES[d.id]?.avatar;
        return (
            <g key={d.id} onClick={() => setSheetAgent(d.id)} style={{ cursor: 'pointer' }}>
                <rect
                    x={x} y={y} width={w} height={h} rx={12}
                    fill="rgba(15,23,42,0.92)"
                    stroke={active ? color : 'rgba(148,163,184,0.25)'}
                    strokeWidth={active ? 2 : 1}
                    style={active ? { filter: `drop-shadow(0 0 8px ${color})` } : undefined}
                />
                {avatar && (
                    <>
                        <clipPath id={`clip-${d.id}`}>
                            <circle cx={x + 30} cy={y + h / 2} r={22} />
                        </clipPath>
                        <image
                            href={avatar}
                            x={x + 8} y={y + h / 2 - 22}
                            width={44} height={44}
                            clipPath={`url(#clip-${d.id})`}
                            opacity={active ? 1 : 0.75}
                        />
                        <circle cx={x + 30} cy={y + h / 2} r={22} fill="none"
                            stroke={active ? color : 'rgba(52,211,153,0.3)'} strokeWidth={1.5} />
                    </>
                )}
                <circle cx={x + 62} cy={y + 17} r={4} fill={color}>
                    {active && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
                </circle>
                <text x={x + 72} y={y + 21} fill="#e2e8f0" fontSize={13} fontWeight={600}>{d.name}</text>
                <text x={x + 62} y={y + 38} fill="#64748b" fontSize={9.5} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{d.cluster}</text>
                <text x={x + 62} y={y + 56} fill={active ? '#cbd5e1' : '#475569'} fontSize={10.5}>
                    {active ? trunc(st.task || 'Arbetar…', 20) : STATUS_LABEL[st.status]}
                </text>
            </g>
        );
    };

    return (
        <div className="office-view" style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px 12px' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>🏢 Kontoret</h2>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                        Main delegerar · subagenter utför · klicka på en agent för rollformuläret
                    </p>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 14 }}>
                    <span>{connected ? '🟢 Gateway' : '🔴 Offline'}</span>
                    <span>{activeCount} aktiva nu</span>
                </div>
            </div>

            <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12 }}>
                <svg viewBox="0 0 1000 720" style={{ flex: 1, height: '100%', minWidth: 0 }}>
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
                    <g onClick={() => setSheetAgent('main')} style={{ cursor: 'pointer' }}>
                        <rect x={MAIN.x - 110} y={MAIN.y - 50} width={220} height={100} rx={14}
                            fill="rgba(2,6,23,0.95)"
                            stroke={mainState.status === 'active' ? STATUS_COLOR.active : '#6366f1'}
                            strokeWidth={2}
                            style={{ filter: `drop-shadow(0 0 14px ${mainState.status === 'active' ? '#22c55e' : '#6366f1'})` }} />
                        <clipPath id="clip-main">
                            <circle cx={MAIN.x - 75} cy={MAIN.y} r={28} />
                        </clipPath>
                        <image href={AGENT_PROFILES['main'].avatar} x={MAIN.x - 103} y={MAIN.y - 28}
                            width={56} height={56} clipPath="url(#clip-main)" />
                        <circle cx={MAIN.x - 75} cy={MAIN.y} r={28} fill="none" stroke="#6366f1" strokeWidth={1.5} />
                        <text x={MAIN.x - 36} y={MAIN.y - 14} fill="#a5b4fc" fontSize={15} fontWeight={700}>⚡ Alex</text>
                        <text x={MAIN.x - 36} y={MAIN.y + 4} fill="#64748b" fontSize={10} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Koordinator</text>
                        <text x={MAIN.x - 36} y={MAIN.y + 24} fill="#cbd5e1" fontSize={11}>
                            {mainState.status === 'active' ? trunc(mainState.task || 'Arbetar…', 22) : 'Redo'}
                        </text>
                    </g>
                </svg>

                {/* ── Aktivitetsfeed: subagent-sessioner från gatewayn ── */}
                <div style={{
                    width: 300, flexShrink: 0, overflowY: 'auto',
                    borderLeft: '1px solid rgba(255,255,255,0.06)', padding: '4px 0 4px 14px',
                }}>
                    <h3 style={{ margin: '2px 0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(52,211,153,0.85)' }}>
                        ◉ Senaste delegeringar
                    </h3>
                    {activity.length === 0 && (
                        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>
                            Inga subagent-körningar ännu. När Alex delegerar dyker de upp här.
                        </div>
                    )}
                    {activity.map(a => (
                        <div key={a.key} style={{
                            padding: '8px 10px', marginBottom: 8, borderRadius: 10,
                            background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                                <span>{a.label}</span>
                                <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>{timeAgo(a.when)}</span>
                            </div>
                            {a.preview && (
                                <div style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.45, color: 'rgba(255,255,255,0.55)' }}>
                                    {a.preview}
                                </div>
                            )}
                            {typeof a.tokens === 'number' && a.tokens > 0 && (
                                <div style={{ marginTop: 3, fontSize: 10.5, color: 'rgba(52,211,153,0.6)' }}>
                                    {a.tokens.toLocaleString('sv-SE')} tokens
                                    {typeof a.costUsd === 'number' && a.costUsd > 0 && ` · $${a.costUsd.toFixed(4)}`}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <CharacterSheet
                agentId={sheetAgent}
                live={sheetAgent ? liveInfo[sheetAgent] : undefined}
                onClose={() => setSheetAgent(null)}
            />
        </div>
    );
}
