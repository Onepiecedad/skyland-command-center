import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Plus, Trash2, CalendarClock } from 'lucide-react';
import { fetchTodos, createTodo, updateTodo, deleteTodo, type Todo } from '../api';
import { focusContact } from '../navigation/uiActions';

/**
 * TodoView — "ska ske"-linsen i cockpit-trion Logg / Att göra / Kalender.
 * Öppna todos grupperade på förfallodatum (Försenat / Idag / Kommande / Utan datum).
 * Auto-genererade todos (svara-DM, förbered-möte) landar här automatiskt.
 */

const PRIO_COLOR: Record<Todo['priority'], string> = {
    urgent: '#e0524f',
    high: '#e0a03a',
    normal: '#6b7f6b',
    low: '#5a5a5a',
};

function startOfToday(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function bucketOf(t: Todo): 'overdue' | 'today' | 'upcoming' | 'none' {
    if (!t.due_at) return 'none';
    const due = new Date(t.due_at).getTime();
    const start = startOfToday();
    if (due < start) return 'overdue';
    if (due < start + 86400000) return 'today';
    return 'upcoming';
}

function fmtDue(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
}

const snoozeBtn: React.CSSProperties = { background: 'none', border: '1px solid #2c2c2c', color: '#9c968a', cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 4, flex: '0 0 auto' };

const GROUPS: { key: ReturnType<typeof bucketOf>; label: string }[] = [
    { key: 'overdue', label: 'Försenat' },
    { key: 'today', label: 'Idag' },
    { key: 'upcoming', label: 'Kommande' },
    { key: 'none', label: 'Utan datum' },
];

export default function TodoView() {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDone, setShowDone] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDue, setNewDue] = useState('');

    const load = useCallback(async () => {
        try {
            const data = await fetchTodos({ done: showDone ? 'all' : 'false', limit: 300 });
            setTodos(data);
        } catch (err) {
            console.error('Failed to load todos:', err);
        }
        setLoading(false);
    }, [showDone]);

    useEffect(() => {
        void load();
        const iv = setInterval(() => void load(), 15000);
        return () => clearInterval(iv);
    }, [load]);

    const add = useCallback(async () => {
        const title = newTitle.trim();
        if (!title) return;
        setNewTitle('');
        const due = newDue ? new Date(newDue + 'T09:00:00').toISOString() : undefined;
        setNewDue('');
        try {
            await createTodo({ title, due_at: due });
            await load();
        } catch (err) {
            console.error('Failed to create todo:', err);
        }
    }, [newTitle, newDue, load]);

    const toggle = useCallback(async (t: Todo) => {
        setTodos(prev => prev.map(x => (x.id === t.id ? { ...x, done: !x.done } : x)));
        try {
            await updateTodo(t.id, { done: !t.done });
            await load();
        } catch {
            void load();
        }
    }, [load]);

    const remove = useCallback(async (id: string) => {
        setTodos(prev => prev.filter(x => x.id !== id));
        try { await deleteTodo(id); } catch { void load(); }
    }, [load]);

    const snooze = useCallback(async (t: Todo, days: number) => {
        const base = t.due_at ? new Date(t.due_at) : new Date();
        base.setDate(base.getDate() + days);
        base.setHours(9, 0, 0, 0);
        try { await updateTodo(t.id, { due_at: base.toISOString() }); await load(); }
        catch { void load(); }
    }, [load]);

    const open = useMemo(() => todos.filter(t => !t.done), [todos]);
    const grouped = useMemo(() => {
        const map: Record<string, Todo[]> = { overdue: [], today: [], upcoming: [], none: [] };
        for (const t of open) map[bucketOf(t)].push(t);
        return map;
    }, [open]);

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, color: '#e8e4d8', padding: '14px 16px', gap: 12 }}>
            {/* Snabb-lägg-till */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void add(); }}
                    placeholder="Lägg till en att-göra…"
                    style={{ flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#e8e4d8', padding: '9px 12px', borderRadius: 6, fontSize: 14, outline: 'none' }}
                />
                <input
                    type="date"
                    value={newDue}
                    onChange={e => setNewDue(e.target.value)}
                    title="Förfallodatum (valfritt)"
                    style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#9c968a', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}
                />
                <button
                    onClick={() => void add()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#9a2b2b', color: '#e8e4d8', border: 'none', padding: '9px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
                >
                    <Plus size={15} /> Lägg till
                </button>
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {loading ? (
                    <p style={{ opacity: 0.5, fontSize: 13 }}>Laddar…</p>
                ) : open.length === 0 ? (
                    <p style={{ opacity: 0.5, fontSize: 14, marginTop: 20 }}>Inget att göra just nu. 🎉</p>
                ) : (
                    GROUPS.map(g => grouped[g.key].length > 0 && (
                        <div key={g.key} style={{ marginBottom: 18 }}>
                            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: g.key === 'overdue' ? '#e0524f' : '#9c968a', marginBottom: 8 }}>
                                {g.label} <span style={{ opacity: 0.6 }}>· {grouped[g.key].length}</span>
                            </div>
                            {grouped[g.key].map(t => (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderBottom: '1px solid #222', background: 'rgba(255,255,255,0.01)' }}>
                                    <button onClick={() => void toggle(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f8a7f', display: 'flex' }} title="Markera klar">
                                        {t.done ? <CheckCircle2 size={18} color="#6b7f6b" /> : <Circle size={18} />}
                                    </button>
                                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO_COLOR[t.priority], flex: '0 0 auto' }} title={t.priority} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            onClick={t.contact_id ? () => focusContact(t.contact_id as string) : undefined}
                                            title={t.contact_id ? 'Öppna kontaktkortet' : undefined}
                                            style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: t.contact_id ? 'pointer' : 'default', color: t.contact_id ? '#e8e4d8' : undefined }}
                                        >
                                            {t.title}{t.contact_id && <span style={{ opacity: 0.4, marginLeft: 5, fontSize: 11 }}>↗</span>}
                                        </div>
                                        {t.notes && <div style={{ fontSize: 12, opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.notes}</div>}
                                    </div>
                                    {t.due_at && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: g.key === 'overdue' ? '#e0524f' : '#9c968a', flex: '0 0 auto' }}>
                                            <CalendarClock size={13} /> {fmtDue(t.due_at)}
                                        </span>
                                    )}
                                    {t.source === 'auto' && <span style={{ fontSize: 10, letterSpacing: 1, color: '#5f7a5f', border: '1px solid #2c3c2c', padding: '1px 5px', borderRadius: 4 }}>AUTO</span>}
                                    <button onClick={() => void snooze(t, 1)} style={snoozeBtn} title="Skjut till imorgon">1d</button>
                                    <button onClick={() => void snooze(t, 7)} style={snoozeBtn} title="Skjut en vecka">1v</button>
                                    <button onClick={() => void remove(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a5a5a', display: 'flex' }} title="Ta bort">
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ))
                )}
            </div>

            <label style={{ fontSize: 12, opacity: 0.55, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
                Visa avklarade
            </label>
        </div>
    );
}
