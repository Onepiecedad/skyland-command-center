import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchTodos, fetchBookings, type Todo, type Booking } from '../api';
import BookingCard from '../components/BookingCard';

/**
 * CalendarView — "ska ske, tidsbundet"-linsen i cockpit-trion.
 * Månadsvy som aggregerar allt med datum: todos (inkl. auto-genererade
 * möten/uppföljningar), ops-deadlines och bokningar (Cal.com-spegeln, SCC-45).
 */

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const MONTHS = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'];

const PRIO_COLOR: Record<Todo['priority'], string> = {
    urgent: '#e0524f', high: '#e0a03a', normal: '#6b7f6b', low: '#5a5a5a',
};

function sameDay(iso: string, d: Date): boolean {
    const t = new Date(iso);
    return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
}

export default function CalendarView() {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [openBooking, setOpenBooking] = useState<string | null>(null);
    const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });

    const load = useCallback(async () => {
        try { setTodos(await fetchTodos({ done: 'all', limit: 500 })); }
        catch (err) { console.error('Failed to load calendar todos:', err); }
        try { setBookings(await fetchBookings()); }
        catch (err) { console.error('Failed to load calendar bookings:', err); }
    }, []);
    useEffect(() => { void load(); const iv = setInterval(() => void load(), 30000); return () => clearInterval(iv); }, [load]);

    const dated = useMemo(() => todos.filter(t => t.due_at), [todos]);
    const datedBookings = useMemo(() => bookings.filter(b => b.starts_at), [bookings]);
    const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

    // 6 veckor (42 celler) med start på måndag
    const cells = useMemo(() => {
        const first = new Date(cursor);
        const weekdayMon = (first.getDay() + 6) % 7; // Mån=0
        const start = new Date(first);
        start.setDate(first.getDate() - weekdayMon);
        return Array.from({ length: 42 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            return d;
        });
    }, [cursor]);

    const today = new Date();
    const move = (delta: number) => { const d = new Date(cursor); d.setMonth(d.getMonth() + delta); setCursor(d); };
    const goToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d); };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, color: '#e8e4d8', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: 0.5 }}>
                    {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
                </h2>
                <div style={{ flex: 1 }} />
                <button onClick={goToday} style={btnStyle}>Idag</button>
                <button onClick={() => move(-1)} style={iconBtnStyle} title="Föregående"><ChevronLeft size={16} /></button>
                <button onClick={() => move(1)} style={iconBtnStyle} title="Nästa"><ChevronRight size={16} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1 }}>
                {WEEKDAYS.map(w => (
                    <div key={w} style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9c968a', textAlign: 'center', padding: '4px 0' }}>{w}</div>
                ))}
            </div>

            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: '1fr', gap: 1, minHeight: 0, overflowY: 'auto' }}>
                {cells.map((d, i) => {
                    const inMonth = d.getMonth() === cursor.getMonth();
                    const isToday = sameDay(d.toISOString(), today);
                    const items = dated.filter(t => sameDay(t.due_at as string, d));
                    const dayBookings = datedBookings.filter(b => sameDay(b.starts_at as string, d));
                    return (
                        <div key={i} style={{
                            border: '1px solid #1e1e1e',
                            background: isToday ? 'rgba(154,43,43,0.14)' : inMonth ? 'rgba(255,255,255,0.012)' : 'transparent',
                            padding: '4px 5px', minHeight: 64, display: 'flex', flexDirection: 'column', gap: 2, opacity: inMonth ? 1 : 0.35,
                        }}>
                            <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#e0a03a' : '#c7c2b6', textAlign: 'right' }}>
                                {d.getDate()}
                            </div>
                            {dayBookings.map(b => {
                                const dead = b.status === 'cancelled' || b.status === 'no_show';
                                return (
                                    <div key={b.id} role="button" tabIndex={0} onClick={() => setOpenBooking(b.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpenBooking(b.id); }}
                                        title={`${b.title || 'Möte'} — ${b.attendee_name || ''} <${b.attendee_email || ''}> (${b.status}) — klicka för detaljer`} style={{
                                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                                        color: dead ? '#6a6a6a' : '#cfe3cf', textDecoration: dead ? 'line-through' : 'none',
                                        background: dead ? 'transparent' : 'rgba(80,150,90,0.16)', borderRadius: 3, padding: '1px 4px',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#8fc99a' }}>{timeOf(b.starts_at as string)}</span>
                                        {b.attendee_name || b.attendee_email || b.title || 'Möte'}
                                    </div>
                                );
                            })}
                            {items.slice(0, 3).map(t => (
                                <div key={t.id} title={t.title} style={{
                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5,
                                    color: t.done ? '#6a6a6a' : '#d8d3c7', textDecoration: t.done ? 'line-through' : 'none',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: PRIO_COLOR[t.priority], flex: '0 0 auto' }} />
                                    {t.title}
                                </div>
                            ))}
                            {items.length > 3 && <div style={{ fontSize: 10, color: '#9c968a' }}>+{items.length - 3} mer</div>}
                        </div>
                    );
                })}
            </div>
            {openBooking && <BookingCard bookingId={openBooking} onClose={() => setOpenBooking(null)} />}
        </div>
    );
}

const btnStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#e8e4d8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const iconBtnStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#e8e4d8', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex' };
