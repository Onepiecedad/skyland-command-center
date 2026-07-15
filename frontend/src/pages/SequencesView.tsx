import { useCallback, useEffect, useState } from 'react';
import {
    fetchSequences,
    fetchSequenceDetail,
    setSequenceStatus,
    type SequenceSummary,
    type SequenceDetail,
    type SequenceStatus,
} from '../api';

const STEP_LABELS: Record<string, string> = {
    send_email: 'Skicka mejl',
    send_sms: 'Skicka SMS',
    wait: 'Vänta',
    wait_until: 'Vänta till (mötestid)',
    branch: 'Gren (villkor)',
    move_stage: 'Flytta stage',
    add_tag: 'Sätt tagg',
    remove_tag: 'Ta bort tagg',
    create_task: 'Skapa uppgift',
    webhook: 'Webhook',
    exit: 'Avsluta',
};

const STATUS_COLOR: Record<SequenceStatus, string> = {
    active: '#3fb950',
    draft: '#8e8b7e',
    paused: '#e9a23b',
};

function stepSummary(type: string, config: Record<string, unknown>): string {
    if (type === 'send_email') return String(config.subject ?? '(inget ämne)');
    if (type === 'send_sms') return String(config.text ?? config.body ?? '');
    if (type === 'wait') {
        const d = config.days ? `${config.days} d` : '';
        const h = config.hours ? `${config.hours} h` : '';
        const m = config.minutes ? `${config.minutes} min` : '';
        return [d, h, m].filter(Boolean).join(' ') || '0';
    }
    if (type === 'wait_until') return `${config.relative_to ?? 'booking_start'} ${config.offset_hours ?? config.offset_minutes ?? 0}h/min`;
    if (type === 'branch') return `${config.condition ?? 'always'}${config.then_exit ? ' → avsluta' : ''}`;
    if (type === 'add_tag' || type === 'remove_tag') return String(config.tag ?? '');
    return '';
}

export default function SequencesView() {
    const [seqs, setSeqs] = useState<SequenceSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const [detail, setDetail] = useState<SequenceDetail | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            setSeqs(await fetchSequences());
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Kunde inte hämta sekvenser');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const toggleOpen = async (id: string): Promise<void> => {
        if (openId === id) {
            setOpenId(null);
            setDetail(null);
            return;
        }
        setOpenId(id);
        setDetail(null);
        try {
            setDetail(await fetchSequenceDetail(id));
        } catch {
            /* tyst — kortet visar ändå status */
        }
    };

    const changeStatus = async (id: string, status: SequenceStatus): Promise<void> => {
        setBusy(id);
        try {
            await setSequenceStatus(id, status);
            await load();
            if (openId === id) setDetail(await fetchSequenceDetail(id));
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Kunde inte ändra status');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={{ padding: '28px 32px', color: '#f4f1e8', maxWidth: 900, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Sekvenser</h1>
                <button onClick={() => void load()} style={ghostBtn}>Uppdatera</button>
            </div>
            <p style={{ color: '#8e8b7e', marginTop: 0, marginBottom: 24 }}>
                Automationsmotorn — drips, påminnelser och no-show-uppföljning. Aktiva sekvenser körs var 60:e sekund.
            </p>

            {loading && <p style={{ color: '#8e8b7e' }}>Laddar…</p>}
            {err && <p style={{ color: '#f85149' }}>{err}</p>}
            {!loading && !seqs.length && <p style={{ color: '#8e8b7e' }}>Inga sekvenser än.</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {seqs.map((s) => {
                    const open = openId === s.id;
                    return (
                        <div key={s.id} style={card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => void toggleOpen(s.id)}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ ...dot, background: STATUS_COLOR[s.status] }} />
                                        <span style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</span>
                                    </div>
                                    <div style={{ color: '#8e8b7e', fontSize: 13, marginTop: 4, fontFamily: 'monospace' }}>
                                        {s.status.toUpperCase()} · trigger: {s.trigger_type}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                                    {s.status !== 'active' ? (
                                        <button disabled={busy === s.id} onClick={() => void changeStatus(s.id, 'active')} style={primaryBtn}>Aktivera</button>
                                    ) : (
                                        <button disabled={busy === s.id} onClick={() => void changeStatus(s.id, 'paused')} style={ghostBtn}>Pausa</button>
                                    )}
                                </div>
                            </div>

                            {open && (
                                <div style={{ marginTop: 16, borderTop: '1px solid rgba(244,241,232,0.1)', paddingTop: 14 }}>
                                    {!detail && <p style={{ color: '#8e8b7e', margin: 0 }}>Laddar steg…</p>}
                                    {detail && detail.sequence.id === s.id && (
                                        <>
                                            {s.description && <p style={{ color: '#8e8b7e', marginTop: 0 }}>{s.description}</p>}
                                            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#8e8b7e', marginBottom: 12, fontFamily: 'monospace' }}>
                                                <span>aktiva: {detail.enrollment_counts.active ?? 0}</span>
                                                <span>klara: {detail.enrollment_counts.completed ?? 0}</span>
                                                <span>avslutade: {detail.enrollment_counts.exited ?? 0}</span>
                                                {detail.sequence.exit_on?.length > 0 && <span>stoppar vid: {detail.sequence.exit_on.join(', ')}</span>}
                                            </div>
                                            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {detail.steps.map((st) => (
                                                    <li key={st.id} style={stepRow}>
                                                        <span style={{ color: '#e9a23b', fontFamily: 'monospace', fontSize: 12, minWidth: 24 }}>{st.position}</span>
                                                        <span style={{ fontWeight: 600, minWidth: 150 }}>{STEP_LABELS[st.type] ?? st.type}</span>
                                                        <span style={{ color: '#8e8b7e', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {stepSummary(st.type, st.config)}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ol>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const card: React.CSSProperties = { background: 'rgba(26,29,34,0.7)', border: '1px solid rgba(244,241,232,0.1)', borderRadius: 14, padding: '16px 20px' };
const dot: React.CSSProperties = { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' };
const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(14,16,19,0.5)', borderRadius: 8, padding: '8px 12px' };
const primaryBtn: React.CSSProperties = { background: '#e9a23b', color: '#12100b', border: 'none', borderRadius: 999, padding: '7px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const ghostBtn: React.CSSProperties = { background: 'transparent', color: '#f4f1e8', border: '1px solid rgba(244,241,232,0.2)', borderRadius: 999, padding: '7px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
