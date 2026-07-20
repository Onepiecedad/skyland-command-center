import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, MessageSquare, TrendingUp, Circle, Activity as ActivityIcon, ShieldCheck, ShieldAlert } from 'lucide-react';
import {
    fetchTodos, fetchActivities, fetchPipelines, fetchBoard,
    type Todo, type Activity, type BoardColumn,
} from '../api';
import { fetchIntegrationsHealth, type IntegrationsHealthResponse } from '../api/system';
import { focusContact } from '../navigation/uiActions';

/**
 * TodayView ("Min dag") — morgonöverblick. Sammanfattar dagens/försenade todos,
 * obesvarade svar, pipeline-läget och senaste händelser i en blick.
 */

function endOfToday(): number {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime();
}

function activitySummary(a: Activity): string {
    const d = (a.details || {}) as Record<string, unknown>;
    const name = d.contact_name ?? d.contact ?? d.name ?? d.kort;
    const bits: string[] = [];
    if (name) bits.push(String(name));
    if (d.from && d.to) bits.push(`${d.from} → ${d.to}`);
    return bits.join(' · ') || a.action;
}

const HOT_STAGES = ['Replied', 'Meeting Booked'];

export default function TodayView() {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [acts, setActs] = useState<Activity[]>([]);
    const [board, setBoard] = useState<BoardColumn[]>([]);
    const [health, setHealth] = useState<IntegrationsHealthResponse | null>(null);

    const load = useCallback(async () => {
        try {
            const [t, a] = await Promise.all([
                fetchTodos({ done: 'false', limit: 300 }),
                fetchActivities({ limit: 8 }),
            ]);
            setTodos(t); setActs(a);
            const pipes = await fetchPipelines();
            const def = pipes.find(p => p.is_default) ?? pipes[0];
            if (def) setBoard(await fetchBoard(def.id));
            try { setHealth(await fetchIntegrationsHealth()); } catch { /* icke-kritiskt */ }
        } catch (err) {
            console.error('Min dag: kunde inte ladda', err);
        }
    }, []);

    useEffect(() => {
        void load();
        const iv = setInterval(() => void load(), 30000);
        return () => clearInterval(iv);
    }, [load]);

    const dueNow = useMemo(
        () => todos.filter(t => t.due_at && new Date(t.due_at).getTime() <= endOfToday())
            .sort((a, b) => new Date(a.due_at as string).getTime() - new Date(b.due_at as string).getTime()),
        [todos],
    );
    const unanswered = useMemo(() => todos.filter(t => /^Svara/i.test(t.title)), [todos]);
    const stageCount = useCallback(
        (name: string) => board.find(c => c.stage.name === name)?.opportunities.length ?? 0, [board],
    );
    const contacted = stageCount('Contacted') + stageCount('Replied') + stageCount('Meeting Booked') + stageCount('Won');
    const replied = stageCount('Replied') + stageCount('Meeting Booked') + stageCount('Won');
    const booked = stageCount('Meeting Booked') + stageCount('Won');
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

    const hej = new Date().getHours() < 10 ? 'God morgon' : new Date().getHours() < 18 ? 'Hej' : 'God kväll';
    const datum = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

    return (
        <div style={{ height: '100%', overflowY: 'auto', minHeight: 0, color: '#e8e4d8', padding: '16px 18px' }}>
            <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{hej}, Joakim.</div>
                <div style={{ fontSize: 13, color: '#9c968a', textTransform: 'capitalize' }}>{datum}</div>
            </div>

            {/* Nyckeltal */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
                <Stat n={dueNow.length} label="Att göra idag" tone={dueNow.length ? '#e0a03a' : '#6b7f6b'} />
                <Stat n={unanswered.length} label="Att svara" tone={unanswered.length ? '#e0524f' : '#6b7f6b'} />
                <Stat n={stageCount('Meeting Booked')} label="Möten bokade" tone="#6b8fbf" />
            </div>

            {/* Att göra idag */}
            <Section icon={<CalendarClock size={14} />} title="Att göra idag">
                {dueNow.length === 0 ? <Empty text="Inget på schemat idag 🎉" /> : dueNow.slice(0, 8).map(t => (
                    <Row key={t.id} onClick={t.contact_id ? () => focusContact(t.contact_id as string) : undefined}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.priority === 'urgent' ? '#e0524f' : t.priority === 'high' ? '#e0a03a' : '#6b7f6b', flex: '0 0 auto' }} />
                        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                        {t.contact_id && <span style={{ opacity: 0.4, fontSize: 11 }}>↗</span>}
                    </Row>
                ))}
            </Section>

            {/* Pipeline-snapshot */}
            <Section icon={<TrendingUp size={14} />} title="Pipeline">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {HOT_STAGES.concat(['Contacted', 'Outreach Ready']).map(s => (
                        <span key={s} style={{ fontSize: 12, color: '#c7c2b6', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 11px' }}>
                            {s} <b style={{ color: '#e8e4d8' }}>{stageCount(s)}</b>
                        </span>
                    ))}
                </div>
            </Section>

            {/* Sälj-KPI:er */}
            <Section icon={<ActivityIcon size={14} />} title="Sälj">
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    <Kpi big={`${pct(replied, contacted)}%`} label="Svarsfrekvens" />
                    <Kpi big={`${pct(booked, contacted)}%`} label="Möteskonvertering" />
                    <Kpi big={String(contacted)} label="Kontaktade totalt" />
                </div>
            </Section>

            {/* Integrationsvakt */}
            <Section
                icon={health && health.overall === 'healthy' ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                title="Integrationer"
            >
                {!health ? <Empty text="Kollar…" /> : health.overall === 'healthy'
                    ? <div style={{ fontSize: 13, color: '#6b8f6b' }}>Allt funkar ✓</div>
                    : health.integrations.filter(i => i.status === 'down' || i.status === 'auth_failed').map(i => (
                        <Row key={i.name}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e0524f', flex: '0 0 auto' }} />
                            <span style={{ flex: 1 }}>{i.name}</span>
                            <span style={{ fontSize: 11, color: '#e0524f' }}>{i.status}</span>
                        </Row>
                    ))}
            </Section>

            {/* Senaste händelser */}
            <Section icon={<MessageSquare size={14} />} title="Senaste">
                {acts.length === 0 ? <Empty text="Inget loggat än" /> : acts.slice(0, 6).map(a => {
                    const cid = (a.details as Record<string, unknown> | null)?.contact_id;
                    const clickable = typeof cid === 'string';
                    return (
                        <Row key={a.id} onClick={clickable ? () => focusContact(cid as string) : undefined}>
                            <Circle size={7} style={{ flex: '0 0 auto', color: a.severity === 'error' ? '#e0524f' : '#5f7a5f' }} />
                            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>{activitySummary(a)}</span>
                            <span style={{ fontSize: 11, color: '#77726a', flex: '0 0 auto' }}>{new Date(a.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</span>
                        </Row>
                    );
                })}
            </Section>
        </div>
    );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #222', borderRadius: 10, padding: '14px 12px' }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: tone, lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: 12, color: '#9c968a', marginTop: 6 }}>{label}</div>
        </div>
    );
}

function Kpi({ big, label }: { big: string; label: string }) {
    return (
        <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#e8e4d8', lineHeight: 1 }}>{big}</div>
            <div style={{ fontSize: 12, color: '#9c968a', marginTop: 5 }}>{label}</div>
        </div>
    );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#9c968a', marginBottom: 10 }}>
                {icon}{title}
            </div>
            {children}
        </div>
    );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
    return (
        <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 4px', borderBottom: '1px solid #1e1e1e', fontSize: 14, cursor: onClick ? 'pointer' : 'default' }}>
            {children}
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return <div style={{ fontSize: 13, color: '#6a655d', padding: '6px 4px' }}>{text}</div>;
}
