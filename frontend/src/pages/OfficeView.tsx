import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchWithAuth } from '../api';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStatus } from '../gateway/fleetApi';
import { getGatewaySocket, type GatewaySession } from '../gateway/gatewaySocket';
import { AGENT_PROFILES } from '../data/agentProfiles';
import { CharacterSheet, type AgentLiveInfo } from '../components/CharacterSheet';
import { navigateToView } from '../navigation/uiActions';

// ─── Static office layout: main in the centre, 8 sub-agents around it ───
const MAIN = { x: 500, y: 360 };

interface Desk {
    id: string;          // agent id (matched against session key segment)
    name: string;
    cluster: string;
    x: number;
    y: number;
}

// Ring of 6 desks around main, grouped by role-adjacency.
// (dm-writer + strategy-analyst togs bort 2026-07-17: DM-utkast genereras av
// den hårdkodade dm_pipeline i scc-crm-skillen, och strategiarbetet sker
// direkt i Alex — ingen av dem är en agent längre.)
const DESKS: Desk[] = [
    { id: 'orchestrator', name: 'Orchestrator', cluster: 'Koordinering', x: 500, y: 110 },
    { id: 'researcher', name: 'Researcher', cluster: 'Research', x: 800, y: 250 },
    { id: 'research-librarian', name: 'Research-librarian', cluster: 'Research', x: 800, y: 470 },
    { id: 'analyst', name: 'Analyst', cluster: 'Analys', x: 500, y: 610 },
    { id: 'writer', name: 'Writer', cluster: 'Copy', x: 200, y: 470 },
    { id: 'lyra', name: 'Lyra', cluster: 'Prompt', x: 200, y: 250 },
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
    /** SCC-49 etapp 2: vad noden faktiskt gör. Ur sessionens brief + nyckel. */
    contact?: string;
    attempt?: number;
    startedAt?: number; // ms
}

// ── SCC-49: batchkort + utfall (backend /agents/office, källa: costs) ──
interface BatchSummary {
    label: string;
    running: boolean;
    done: number; reruns: number; failed: number; total: number;
    costUsd: number;
    avgDurationS: number | null;
    lastContact: string | null;
    lastAt: string | null;
    etaMinutes: number | null;
}
interface AgentOutcome { contact: string | null; result: 'ok' | 'rerun' | 'failed'; at: string; durationS: number | null }

// Etapp 4: tre hälsolampor (backend /agents/office/health)
type Lamp = 'ok' | 'warn' | 'down' | 'unknown';
interface LampInfo { lamp: Lamp; detail: string; at: string | null }
interface OfficeHealth { integrations: LampInfo; poller: LampInfo; preflight: LampInfo }
const LAMP_COLOR: Record<Lamp, string> = { ok: '#22c55e', warn: '#f59e0b', down: '#ef4444', unknown: '#475569' };
const LAMP_LABEL: Record<keyof OfficeHealth, string> = { integrations: 'Integrationer', poller: 'Poller', preflight: 'Preflight' };

const OUTCOME_COLOR: Record<AgentOutcome['result'], string> = { ok: '#22c55e', rerun: '#f59e0b', failed: '#ef4444' };
const RESEARCH_BUDGET_S = 600;   // researchens tak i prospect_pipeline
const GLOW_MS = 10 * 60_000;

/** Kortets namn ur briefen ("Klinik: X" / "Studio: X" / "Namn: X"). */
function contactFromBrief(text: string): string | null {
    const m = /^(?:Klinik|Studio|Namn|Name|Företag|Kontakt):\s*(.+)$/im.exec(text);
    return m ? m[1].trim().slice(0, 40) : null;
}

/** Starttid ur sessionsnyckeln: agent:researcher:hook:prospect-<unix>-<pid>. */
function startFromKey(key: string): number | null {
    const m = /prospect-(\d{10})-/.exec(key);
    return m ? Number(m[1]) * 1000 : null;
}

/** Etapp 3: rå brief/JSON → människospråk i flödet. Okänt faller tillbaka på texten. */
function humanizePreview(preview: string, contact: string | null): string {
    if (!preview) return '';
    if (/^RESEARCH-UPPDRAG/i.test(preview)) return `Researchar ${contact ?? 'ett kort'}`;
    if (/^Ditt förra svar/i.test(preview)) return `Omkörning med skärpt brief: ${contact ?? ''}`.trim();
    if (/IDENTITET VERIFIERAD/i.test(preview)) return `Identitet verifierad: ${contact ?? ''}`.trim();
    if (/^\s*\{/.test(preview)) {
        try {
            const j = JSON.parse(preview);
            if (j.query) return `Söker: ${String(j.query).replace(/"/g, '')}${j.provider ? ` (${j.provider})` : ''}`;
            if (j.url) return `Läser: ${String(j.url).replace(/^https?:\/\//, '').slice(0, 60)}`;
        } catch { /* rå JSON blir kvar */ }
    }
    return preview;
}

function fmtRemaining(s: number): string {
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
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
    const [batch, setBatch] = useState<BatchSummary | null>(null);
    const [health, setHealth] = useState<OfficeHealth | null>(null);

    // Hälsolamporna: var 60:e sekund räcker, backend cachar probarna lika länge.
    useEffect(() => {
        let stop = false;
        const load = async () => {
            try {
                const res = await fetchWithAuth('/api/v1/agents/office/health');
                if (res.ok && !stop) setHealth(await res.json());
            } catch { /* lamporna blir grå */ }
        };
        load();
        const t = setInterval(load, 60_000);
        return () => { stop = true; clearInterval(t); };
    }, []);
    const [outcomes, setOutcomes] = useState<Record<string, AgentOutcome[]>>({});
    const [nowMs, setNowMs] = useState(Date.now());
    // Briefen per sessionsnyckel hämtas EN gång — inte var femte sekund.
    const briefRef = useRef<Record<string, { contact: string | null; attempt: number }>>({});
    const reduceMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Sekundklocka för förloppsringen och glödens avklingning.
    useEffect(() => {
        const t = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    // Batchkortet + utfall: alltid från backend, oavsett om gatewayn nås.
    const refreshOffice = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/v1/agents/office');
            if (!res.ok) return;
            const data = await res.json();
            setBatch(data.batch ?? null);
            setOutcomes(data.outcomes ?? {});
        } catch { /* kortet uteblir, vyn lever */ }
    }, []);

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
                    // Hela historiken första gången (briefen ligger först), sedan bara svansen.
                    const known = briefRef.current[s.key];
                    const h = await socket.getChatHistory(s.key, known ? 5 : 40);
                    const msgs = h.messages || [];
                    if (!known) {
                        const users = msgs.filter(m => m.role === 'user' && (m.content || '').trim());
                        const brief = users[0]?.content ?? '';
                        briefRef.current[s.key] = {
                            contact: contactFromBrief(brief),
                            attempt: 1 + users.filter(m => /^Ditt förra svar|komplettera det/i.test(m.content || '')).length,
                        };
                    }
                    const withText = msgs.filter(m =>
                        (m.content || '').trim() && !HEARTBEAT_NOISE.test(m.content || ''));
                    preview = withText[withText.length - 1]?.content?.slice(0, 110) ?? '';
                } catch { /* best effort */ }
                const deskId = deskIdForSession(s);
                const deskName = deskId ? DESKS.find(d => d.id === deskId)?.name : undefined;
                const b = briefRef.current[s.key];
                const contact = b?.contact ?? null;
                return {
                    key: s.key,
                    label: (deskName || s.label || `Alex · sub-agent ${s.key.split(':')[3]?.slice(0, 6) ?? ''}`)
                        + (contact ? ` · ${contact}` : ''),
                    when: s.lastMessageAt,
                    tokens: s.tokenCount,
                    costUsd: s.costUsd,
                    preview: humanizePreview(preview, contact),
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
                const b = sess ? briefRef.current[sess.key] : undefined;
                next[d.id] = {
                    status,
                    task: fresh ? (b?.contact ? `Researchar ${b.contact}` : (sess?.label || 'Arbetar…')) : '',
                    contact: fresh ? b?.contact ?? undefined : undefined,
                    attempt: fresh ? b?.attempt : undefined,
                    startedAt: fresh && sess ? startFromKey(sess.key) ?? undefined : undefined,
                };
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
            await refreshOffice();
        };
        tick();
        const t = setInterval(tick, 5000);
        return () => { stop = true; clearInterval(t); };
    }, [refreshGateway, refreshBackend, refreshOffice]);

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

        // Etapp 2: utfallsglöd i 10 min efter avslut (grön/bärnsten/röd) + fem prickar som minne.
        const hist = outcomes[d.id] ?? [];
        const last = hist[0];
        const lastAge = last ? nowMs - new Date(last.at).getTime() : Infinity;
        const glow = !active && last && lastAge < GLOW_MS ? last : null;
        const glowColor = glow ? OUTCOME_COLOR[glow.result] : null;
        const glowAlpha = glow ? Math.max(0.25, 1 - lastAge / GLOW_MS) : 0;
        const stroke = active ? color : glowColor ? glowColor : 'rgba(148,163,184,0.25)';

        // Förloppsring mot researchens 600 s-tak, från sessionens starttid.
        const elapsedS = active && st.startedAt ? Math.max(0, Math.floor((nowMs - st.startedAt) / 1000)) : null;
        const frac = elapsedS !== null ? Math.min(1, elapsedS / RESEARCH_BUDGET_S) : 0;
        const ringR = 11, ringC = 2 * Math.PI * ringR;
        const bubble = active && (st.contact || st.attempt || elapsedS !== null);
        const bubbleLine1 = st.contact ? `Researchar ${st.contact}` : (st.task || 'Arbetar…');
        const bubbleLine2 = [
            st.attempt ? `försök ${st.attempt}` : null,
            elapsedS !== null ? (elapsedS < RESEARCH_BUDGET_S ? `${fmtRemaining(RESEARCH_BUDGET_S - elapsedS)} kvar` : 'över taket') : null,
        ].filter(Boolean).join(' · ');
        const bw = Math.min(230, Math.max(150, 8 * Math.max(bubbleLine1.length, bubbleLine2.length) + 24));
        const bx = d.x - bw / 2, by = y - 54;

        return (
            <g key={d.id} onClick={() => setSheetAgent(d.id)} style={{ cursor: 'pointer' }}>
                <rect
                    x={x} y={y} width={w} height={h} rx={12}
                    fill="rgba(15,23,42,0.92)"
                    stroke={stroke}
                    strokeWidth={active || glow ? 2 : 1}
                    strokeOpacity={glow ? glowAlpha : 1}
                    style={active ? { filter: `drop-shadow(0 0 8px ${color})` }
                        : glow ? { filter: `drop-shadow(0 0 ${Math.round(10 * glowAlpha)}px ${glowColor})` } : undefined}
                />
                {/* utfallsminne: senaste fem, nyast till vänster */}
                {hist.slice(0, 5).map((o, i) => (
                    <circle key={i} cx={x + 66 + i * 9} cy={y + h - 9} r={2.6}
                        fill={OUTCOME_COLOR[o.result]} opacity={i === 0 ? 0.95 : 0.55}>
                        <title>{`${o.contact ?? '?'} · ${o.result}${o.durationS ? ` · ${Math.round(o.durationS / 60)} min` : ''}`}</title>
                    </circle>
                ))}
                {/* förloppsring: hur långt in i 600 s-taket researchen är */}
                {active && elapsedS !== null && (
                    <g transform={`translate(${x + w - 18}, ${y + h / 2})`}>
                        <circle r={ringR} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth={2.5} />
                        <circle r={ringR} fill="none" stroke={frac < 0.8 ? color : '#f59e0b'} strokeWidth={2.5}
                            strokeDasharray={`${ringC * frac} ${ringC}`} strokeLinecap="round"
                            transform="rotate(-90)" />
                    </g>
                )}
                {/* pratbubbla: vad, försök, tid kvar */}
                {bubble && (
                    <g>
                        <rect x={bx} y={by} width={bw} height={38} rx={9}
                            fill="rgba(2,6,23,0.96)" stroke={color} strokeWidth={1} />
                        <path d={`M ${d.x - 6} ${by + 38} L ${d.x} ${by + 45} L ${d.x + 6} ${by + 38} Z`} fill="rgba(2,6,23,0.96)" stroke={color} strokeWidth={1} />
                        <rect x={d.x - 5} y={by + 36} width={10} height={3} fill="rgba(2,6,23,0.96)" />
                        <text x={d.x} y={by + 16} textAnchor="middle" fill="#e2e8f0" fontSize={11.5} fontWeight={600}>{trunc(bubbleLine1, 30)}</text>
                        <text x={d.x} y={by + 30} textAnchor="middle" fill="#94a3b8" fontSize={10}>{bubbleLine2}</text>
                    </g>
                )}
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
                <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 14, alignItems: 'center' }}>
                    {/* Etapp 4: tre lampor — klick går till System-fliken */}
                    <button type="button" onClick={() => navigateToView('system')}
                        title={health ? (['integrations', 'poller', 'preflight'] as const).map(k => `${LAMP_LABEL[k]}: ${health[k].detail}`).join('\n') : 'Hälsa hämtas…'}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: '#94a3b8', font: 'inherit' }}>
                        {(['integrations', 'poller', 'preflight'] as const).map(k => {
                            const l = health?.[k].lamp ?? 'unknown';
                            return (
                                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 4, background: LAMP_COLOR[l], boxShadow: l === 'ok' ? '0 0 6px rgba(34,197,94,0.6)' : l === 'down' ? '0 0 6px rgba(239,68,68,0.7)' : 'none' }} />
                                    <span style={{ fontSize: 11 }}>{LAMP_LABEL[k]}</span>
                                </span>
                            );
                        })}
                    </button>
                    <span>{connected ? '🟢 Gateway' : '🔴 Offline'}</span>
                    <span>{activeCount} aktiva nu</span>
                </div>
            </div>

            {/* Mobil: agentkartan blir oläslig liten — visa en tydlig lista i
                stället (samma klick öppnar rollformuläret). CSS togglar. */}
            <div className="office-agent-list">
                {batch && (
                    <div className="office-agent-row" style={{ cursor: 'default', fontSize: 12.5 }}>
                        <span className="office-agent-name">{batch.label} {batch.running ? '· pågår' : '· klar'}</span>
                        <span className="office-agent-status">{batch.done} klara · {batch.failed} fel · ${batch.costUsd.toFixed(2)}</span>
                    </div>
                )}
                {[{ id: 'main', name: 'Alex', cluster: 'Koordinator' } as { id: string; name: string; cluster: string }, ...DESKS].map((d) => {
                    const st = d.id === 'main' ? mainState.status : (desks[d.id]?.status ?? 'idle');
                    const avatar = AGENT_PROFILES[d.id]?.avatar;
                    return (
                        <button key={d.id} className="office-agent-row" onClick={() => setSheetAgent(d.id)}>
                            <span className="office-agent-avatar" style={{ borderColor: STATUS_COLOR[st] }}>
                                {avatar
                                    ? <img src={avatar} alt="" />
                                    : <span>{d.name.charAt(0)}</span>}
                                <span className="office-agent-dot" style={{ background: STATUS_COLOR[st] }} />
                            </span>
                            <span className="office-agent-name">{d.name}</span>
                            <span className="office-agent-cluster">{d.cluster}</span>
                            <span className="office-agent-status">{st === 'active' ? 'Arbetar' : st === 'idle' ? 'Ledig' : st}</span>
                        </button>
                    );
                })}
            </div>

            <div className="office-map-wrap" style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, position: 'relative' }}>
                {/* Etapp 1: batchkortet — EN sammanhållen körning, inte lösa delegeringar */}
                {batch && (
                    <div className="office-batch-card" style={{
                        position: 'absolute', top: 6, left: 10, zIndex: 2, minWidth: 250,
                        padding: '10px 14px', borderRadius: 12,
                        background: 'rgba(2,6,23,0.92)',
                        border: `1px solid ${batch.running ? 'rgba(34,197,94,0.6)' : 'rgba(148,163,184,0.25)'}`,
                        boxShadow: batch.running ? '0 0 18px rgba(34,197,94,0.25)' : 'none',
                        fontSize: 12.5, color: '#e2e8f0',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
                            <span style={{
                                width: 8, height: 8, borderRadius: 4, display: 'inline-block',
                                background: batch.running ? '#22c55e' : '#64748b',
                                animation: batch.running && !reduceMotion ? 'officePulse 1.2s ease-in-out infinite' : 'none',
                            }} />
                            {batch.label}
                            <span style={{ fontWeight: 400, color: '#94a3b8' }}>{batch.running ? '· pågår' : '· klar'}</span>
                        </div>
                        <div style={{ marginTop: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, letterSpacing: 0.2 }}>
                            <span style={{ color: '#22c55e' }}>{batch.done}</span> klara
                            {batch.reruns > 0 && <> · <span style={{ color: '#f59e0b' }}>{batch.reruns}</span> omkörning{batch.reruns > 1 ? 'ar' : ''}</>}
                            {' · '}<span style={{ color: batch.failed ? '#ef4444' : '#94a3b8' }}>{batch.failed}</span> fel
                            {' · '}${batch.costUsd.toFixed(2)}
                            {batch.avgDurationS ? ` · ~${Math.round(batch.avgDurationS / 60)} min/kort` : ''}
                        </div>
                        <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 11.5 }}>
                            {batch.running
                                ? <>senast: {batch.lastContact ?? '–'}{batch.etaMinutes !== null ? ` · klar om ~${batch.etaMinutes} min` : ''}</>
                                : <>{batch.total} kort · senast {timeAgo(batch.lastAt ?? undefined)} · {batch.lastContact ?? ''}</>}
                        </div>
                    </div>
                )}
                <style>{`@keyframes officePulse { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .45; transform: scale(.8) } }`}</style>
                <svg viewBox="0 0 1000 720" style={{ flex: 1, height: '100%', minWidth: 0 }}>
                    {/* connection lines main ↔ desk */}
                    {DESKS.map((d) => {
                        const st = desks[d.id]?.status ?? 'idle';
                        const active = st === 'active';
                        return (
                            <g key={`l-${d.id}`}>
                                <line x1={MAIN.x} y1={MAIN.y} x2={d.x} y2={d.y}
                                    stroke={active ? 'rgba(34,197,94,0.35)' : 'rgba(100,116,139,0.18)'}
                                    strokeWidth={active ? 2 : 1}
                                    strokeDasharray={active ? '0' : '4 6'} />
                                {/* Etapp 4: pulsen längs kanten medan noden arbetar. Stilla vid reduced-motion. */}
                                {active && (
                                    <line x1={MAIN.x} y1={MAIN.y} x2={d.x} y2={d.y}
                                        stroke={STATUS_COLOR.active} strokeWidth={2.5} strokeLinecap="round"
                                        strokeDasharray="10 14" style={{ filter: 'drop-shadow(0 0 4px #22c55e)' }}>
                                        {!reduceMotion && (
                                            <animate attributeName="stroke-dashoffset" from="0" to="-48" dur="1.1s" repeatCount="indefinite" />
                                        )}
                                    </line>
                                )}
                            </g>
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
