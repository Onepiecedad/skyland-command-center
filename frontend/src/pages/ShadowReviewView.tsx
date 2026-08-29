import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchShadowReview,
    setShadowReview,
    type ShadowEnrollment,
    type ShadowMessage,
    type ReviewVerdict,
} from '../api';

/**
 * Skuggvecka (SCC-46) — facit-vyn för databasreaktiveringen.
 *
 * Varje kort i en sekvens listas med det motorn loggat: skuggmejl (aldrig
 * skickade), riktiga utskick, hoppade steg, och när nästa steg går. Operatören
 * dömer varje meddelande: "hade skickat" / "hade inte skickat" + valfri
 * anteckning. Andelen "hade skickat" är måttet på om autosend kan slås på.
 */

const AMBER = '#E9A94A';
const GREEN = '#3fb950';
const RED = '#ff6b6b';
const MUTED = 'rgba(244,241,232,0.55)';

const STEP_LABEL: Record<string, string> = {
    send_email: 'mejl', send_sms: 'sms', wait: 'väntar', branch: 'kollar svar',
    move_stage: 'flyttar stage', exit: 'avslut', add_tag: 'tagg', remove_tag: 'tagg bort',
    create_task: 'uppgift', webhook: 'webhook', wait_until: 'väntar till',
};

function fmt(iso: string | null): string {
    if (!iso) return '–';
    const d = new Date(iso);
    return d.toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusChip(status: string | null): { label: string; color: string; dashed: boolean } {
    if (status === 'shadow') return { label: 'SKUGGA · ej skickat', color: AMBER, dashed: true };
    if (status === 'sent' || status === 'delivered') return { label: 'SKICKAT PÅ RIKTIGT', color: '#5a8cff', dashed: false };
    if (status === 'bounced') return { label: 'STUDSADE', color: RED, dashed: false };
    if (status === 'complained') return { label: 'KLAGOMÅL', color: RED, dashed: false };
    if (status === 'failed') return { label: 'MISSLYCKADES', color: RED, dashed: false };
    return { label: String(status ?? 'okänd'), color: MUTED, dashed: false };
}

function enrollmentChip(status: string, exitReason: string | null): { label: string; color: string } {
    if (status === 'active') return { label: 'pågår', color: GREEN };
    if (status === 'completed') return { label: 'klar', color: MUTED };
    if (status === 'exited') return { label: `avslutad · ${exitReason ?? ''}`, color: exitReason === 'suppressed' ? RED : AMBER };
    if (status === 'failed') return { label: `fel · ${exitReason ?? ''}`, color: RED };
    return { label: status, color: MUTED };
}

function MessageCard({ m, onReview }: { m: ShadowMessage; onReview: (id: string, v: ReviewVerdict | null, note?: string) => Promise<void> }) {
    const chip = statusChip(m.status);
    const [note, setNote] = useState(m.review?.note ?? '');
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const verdict = m.review?.verdict ?? null;

    const submit = async (v: ReviewVerdict | null) => {
        setBusy(true);
        try { await onReview(m.id, v, note); } finally { setBusy(false); }
    };

    const [subject, ...bodyLines] = m.content.split('\n');
    const body = bodyLines.join('\n').trim();

    return (
        <div style={{
            border: chip.dashed ? `1px dashed ${chip.color}99` : `1px solid ${chip.color}55`,
            background: chip.dashed ? 'rgba(233,169,74,0.06)' : 'rgba(255,255,255,0.03)',
            borderRadius: 10, padding: '10px 12px', marginTop: 8,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: MUTED }}>
                <span style={{ padding: '1px 7px', borderRadius: 6, background: `${chip.color}33`, color: chip.color, fontWeight: 700, letterSpacing: 0.4 }}>
                    {chip.label}
                </span>
                <span>{m.channel} → {m.to ?? '?'}</span>
                <span>· {fmt(m.created_at)}</span>
                {verdict && (
                    <span style={{ marginLeft: 'auto', color: verdict === 'would_send' ? GREEN : RED, fontWeight: 600 }}>
                        {verdict === 'would_send' ? '✓ hade skickat' : '✗ hade inte skickat'}
                    </span>
                )}
            </div>
            <div style={{ marginTop: 6, fontWeight: 600, fontSize: 13 }}>{subject}</div>
            <div
                onClick={() => setOpen(o => !o)}
                style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap', cursor: 'pointer', opacity: 0.92,
                    maxHeight: open ? 'none' : 72, overflow: 'hidden', position: 'relative' }}
                title={open ? 'Klicka för att fälla ihop' : 'Klicka för hela texten'}
            >
                {body}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={() => submit('would_send')} style={btn(verdict === 'would_send' ? GREEN : undefined)}>
                    Hade skickat
                </button>
                <button disabled={busy} onClick={() => submit('would_not_send')} style={btn(verdict === 'would_not_send' ? RED : undefined)}>
                    Hade inte skickat
                </button>
                <input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    onBlur={() => { if (verdict && note !== (m.review?.note ?? '')) void submit(verdict); }}
                    placeholder="Varför? (fel detalj, fel ton, för långt…)"
                    style={{ flex: 1, minWidth: 180, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6, color: '#f4f1e8', padding: '5px 8px', fontSize: 12 }}
                />
                {verdict && (
                    <button disabled={busy} onClick={() => submit(null)} style={{ ...btn(), opacity: 0.6 }} title="Ta bort bedömningen">
                        Ångra
                    </button>
                )}
            </div>
        </div>
    );
}

function btn(active?: string): React.CSSProperties {
    return {
        background: active ? `${active}33` : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ?? 'rgba(255,255,255,0.14)'}`,
        color: active ?? '#f4f1e8', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
    };
}

export default function ShadowReviewView() {
    const [rows, setRows] = useState<ShadowEnrollment[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setErr(null);
        try { setRows(await fetchShadowReview()); }
        catch (e) { setErr(e instanceof Error ? e.message : 'Kunde inte hämta skuggveckan'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const onReview = useCallback(async (id: string, v: ReviewVerdict | null, note?: string) => {
        await setShadowReview(id, v, note);
        setRows(prev => prev.map(r => ({
            ...r,
            messages: r.messages.map(m => m.id === id
                ? { ...m, review: v ? { verdict: v, note: note ?? null, at: new Date().toISOString() } : null }
                : m),
        })));
    }, []);

    const stats = useMemo(() => {
        const all = rows.flatMap(r => r.messages);
        const shadow = all.filter(m => m.status === 'shadow');
        const real = all.filter(m => m.status === 'sent' || m.status === 'delivered');
        const judged = all.filter(m => m.review);
        const ok = judged.filter(m => m.review?.verdict === 'would_send');
        const skipped = rows.flatMap(r => r.runs).filter(x => x.status === 'skipped');
        return { total: all.length, shadow: shadow.length, real: real.length, judged: judged.length, ok: ok.length, skipped: skipped.length,
            pct: judged.length ? Math.round((ok.length / judged.length) * 100) : null };
    }, [rows]);

    return (
        <div style={{ padding: '28px 32px', color: '#f4f1e8', maxWidth: 960, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Skuggvecka</h2>
                <button onClick={() => void load()} style={btn()}>Uppdatera</button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: MUTED }}>
                Det motorn hade skickat, utan att skicka. Döm varje meddelande som om det låg i din utkorg.
                Autosend slås på först när andelen "hade skickat" är hög nog att du litar på den.
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
                <Stat label="kort i sekvens" value={rows.length} />
                <Stat label="skuggmejl" value={stats.shadow} color={AMBER} />
                <Stat label="riktiga utskick" value={stats.real} color="#5a8cff" />
                <Stat label="hoppade steg" value={stats.skipped} color={stats.skipped ? RED : undefined} />
                <Stat label="bedömda" value={`${stats.judged} / ${stats.total}`} />
                <Stat label="hade skickat" value={stats.pct === null ? '–' : `${stats.pct} %`} color={stats.pct === null ? undefined : stats.pct >= 90 ? GREEN : stats.pct >= 70 ? AMBER : RED} />
            </div>

            {loading && <p style={{ opacity: 0.6 }}>Laddar…</p>}
            {err && <p style={{ color: RED }}>Fel: {err}</p>}
            {!loading && !err && rows.length === 0 && (
                <p style={{ opacity: 0.5, fontSize: 13 }}>Inga kort i någon sekvens än.</p>
            )}

            {rows.map(r => {
                const ec = enrollmentChip(r.enrollment.status, r.enrollment.exit_reason);
                const skips = r.runs.filter(x => x.status === 'skipped');
                return (
                    <div key={r.enrollment.id} style={{
                        border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '14px 16px', marginBottom: 14,
                        background: 'rgba(255,255,255,0.025)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 15 }}>{r.contact?.name ?? '(kontakt saknas)'}</span>
                            <span style={{ fontSize: 12, color: MUTED }}>{r.contact?.email ?? 'ingen e-post'}</span>
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 6, background: `${ec.color}22`, color: ec.color, fontWeight: 600 }}>{ec.label}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>{r.sequence.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: MUTED }}>
                            <span>
                                nästa: {r.next_step
                                    ? <b style={{ color: '#f4f1e8' }}>{STEP_LABEL[r.next_step.type] ?? r.next_step.type}{r.next_step.type === 'send_email' && r.next_step.config.part ? ` (${String(r.next_step.config.part)})` : ''}</b>
                                    : <b style={{ color: '#f4f1e8' }}>inget</b>} · {r.enrollment.status === 'active' ? fmt(r.enrollment.next_run_at) : '–'}
                            </span>
                            <span>DM på kortet: {r.contact?.has_dm ? '✓' : <b style={{ color: RED }}>saknas</b>}</span>
                            <span>bump på kortet: {r.contact?.has_bump ? '✓' : <b style={{ color: AMBER }}>saknas</b>}</span>
                        </div>
                        {skips.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 12, color: RED }}>
                                Hoppade steg: {skips.map((s, i) => <span key={i}>{STEP_LABEL[s.step_type] ?? s.step_type} ({String(s.detail?.reason ?? '')}) </span>)}
                            </div>
                        )}
                        {r.messages.length === 0 && (
                            <div style={{ marginTop: 8, fontSize: 12, color: MUTED }}>Inget loggat än.</div>
                        )}
                        {r.messages.map(m => <MessageCard key={m.id} m={m} onReview={onReview} />)}
                    </div>
                );
            })}
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
    return (
        <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '8px 14px', minWidth: 110 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#f4f1e8' }}>{value}</div>
            <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
        </div>
    );
}
