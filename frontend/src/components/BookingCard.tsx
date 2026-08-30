import { useEffect, useState } from 'react';
import { X, Video, ExternalLink, User, Phone, Mail, Clock, MessageSquareText, FileText } from 'lucide-react';
import { fetchBookingDetail, type BookingDetail } from '../api';
import { focusContact } from '../navigation/uiActions';

/**
 * BookingCard — detaljkort för en bokning i kalendern (SCC-45).
 * Visar tid, Meet-länk, deltagare, kopplad kontakt, och det SCC redan vet om
 * personen: senaste röstsamtalet (LLM-sammanfattning) och/eller formuläret.
 * Avboka/omboka går via Cal.com som äger bokningen.
 */

const STATUS_LABEL: Record<string, string> = { booked: 'Bokad', cancelled: 'Avbokad', rescheduled: 'Ombokad', no_show: 'Uteblev' };
const STATUS_COLOR: Record<string, string> = { booked: '#8fc99a', cancelled: '#e0524f', rescheduled: '#e0a03a', no_show: '#e0524f' };

function fmtRange(start: string | null, end: string | null): string {
    if (!start) return '—';
    const s = new Date(start);
    const day = s.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
    const t1 = s.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const t2 = end ? new Date(end).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : null;
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${t1}${t2 ? `–${t2}` : ''}`;
}

export default function BookingCard({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
    const [d, setD] = useState<BookingDetail | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        fetchBookingDetail(bookingId).then(x => { if (alive) setD(x); }).catch(e => { if (alive) setErr(String(e)); });
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => { alive = false; window.removeEventListener('keydown', onKey); };
    }, [bookingId, onClose]);

    const b = d?.booking;
    const ex = (d?.voice_call?.extracted_data || {}) as Record<string, unknown>;
    const painPoints = Array.isArray(ex.pain_points) ? (ex.pain_points as string[]) : [];

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{
                width: 'min(560px, 100%)', maxHeight: '88vh', overflowY: 'auto', background: '#121612', border: '1px solid #2a2f2a',
                borderRadius: 10, color: '#e8e4d8', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14,
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9c968a' }}>{b?.event_title || 'Möte'}{b?.length_minutes ? ` · ${b.length_minutes} min` : ''}</div>
                        <h3 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 600, textWrap: 'balance' as never }}>{b?.attendee_name || b?.attendee_email || '…'}</h3>
                    </div>
                    {b && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, border: `1px solid ${STATUS_COLOR[b.status] || '#555'}`, color: STATUS_COLOR[b.status] || '#ccc' }}>{STATUS_LABEL[b.status] || b.status}</span>}
                    <button onClick={onClose} aria-label="Stäng" style={{ background: 'transparent', border: 0, color: '#9c968a', cursor: 'pointer', padding: 2 }}><X size={18} /></button>
                </div>

                {err && <div style={{ color: '#e0524f', fontSize: 13 }}>Kunde inte hämta bokningen: {err}</div>}
                {!d && !err && <div style={{ color: '#9c968a', fontSize: 13 }}>Hämtar…</div>}

                {b && (<>
                    <Row icon={<Clock size={14} />}>{fmtRange(b.starts_at, b.ends_at)}{b.attendee_timezone && b.attendee_timezone !== 'Europe/Stockholm' ? ` (deltagarens tidszon: ${b.attendee_timezone})` : ''}</Row>
                    {b.attendee_email && <Row icon={<Mail size={14} />}><a href={`mailto:${b.attendee_email}`} style={linkStyle}>{b.attendee_email}</a></Row>}
                    {(b.attendee_phone || d?.contact?.phone) && <Row icon={<Phone size={14} />}>{b.attendee_phone || d?.contact?.phone}</Row>}
                    {d?.contact && (
                        <Row icon={<User size={14} />}>
                            <button onClick={() => { focusContact(d.contact!.id, d.contact!.name); onClose(); }} style={{ ...linkStyle, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                                {d.contact.name || d.contact.email}{d.contact.company ? ` · ${d.contact.company}` : ''}
                            </button>
                            <span style={{ color: '#9c968a', fontSize: 12 }}> — öppna i CRM{d.contact.status ? ` (${d.contact.status})` : ''}</span>
                        </Row>
                    )}
                    {!d?.contact && <Row icon={<User size={14} />}><span style={{ color: '#9c968a' }}>Ingen kontakt matchad på mejlen.</span></Row>}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {b.meet_url && <a href={b.meet_url} target="_blank" rel="noreferrer" style={primaryBtn}><Video size={14} /> Gå till Meet</a>}
                        {b.reschedule_url && <a href={b.reschedule_url} target="_blank" rel="noreferrer" style={ghostBtn}>Omboka <ExternalLink size={12} /></a>}
                        {b.cancel_url && b.status === 'booked' && <a href={b.cancel_url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, borderColor: '#5a2b2b', color: '#e0a09e' }}>Avboka <ExternalLink size={12} /></a>}
                    </div>

                    {b.cancellation_reason && <Section title="Avbokningsorsak">{b.cancellation_reason}</Section>}
                    {b.notes && <Section title="Meddelande från bokningen">{b.notes}</Section>}

                    {d?.voice_call && (
                        <Section title={<><MessageSquareText size={13} /> Röstsamtal på sajten{d.voice_call.duration_seconds ? ` · ${Math.round(d.voice_call.duration_seconds / 60)} min` : ''}{d.voice_call.ended_at ? ` · ${new Date(d.voice_call.ended_at).toLocaleDateString('sv-SE')}` : ''}</>}>
                            {d.voice_call.summary && <p style={{ margin: '0 0 8px' }}>{d.voice_call.summary}</p>}
                            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: 12.5 }}>
                                {typeof ex.company_name === 'string' && ex.company_name && <><dt style={dt}>Företag</dt><dd style={dd}>{ex.company_name}</dd></>}
                                {typeof ex.industry === 'string' && ex.industry && <><dt style={dt}>Bransch</dt><dd style={dd}>{ex.industry}</dd></>}
                                {painPoints.length > 0 && <><dt style={dt}>Smärtpunkter</dt><dd style={dd}>{painPoints.join(', ')}</dd></>}
                                {typeof ex.current_process === 'string' && ex.current_process && <><dt style={dt}>Idag</dt><dd style={dd}>{ex.current_process}</dd></>}
                            </dl>
                        </Section>
                    )}
                    {d?.form && (
                        <Section title={<><FileText size={13} /> Formulär på sajten · poäng {d.form.score ?? 0}</>}>
                            {d.form.company && <div style={{ color: '#9c968a', fontSize: 12, marginBottom: 4 }}>{d.form.company}</div>}
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.form.message}</p>
                        </Section>
                    )}
                    {!d?.voice_call && !d?.form && <div style={{ color: '#9c968a', fontSize: 12.5 }}>Inget röstsamtal eller formulär hittat för den här mejladressen — bokningen gjordes troligen direkt via Cal.com-länken.</div>}

                    <div style={{ fontSize: 11, color: '#6f6a60', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>Källa: {b.source}</span>
                        {b.calcom_url && <a href={b.calcom_url} target="_blank" rel="noreferrer" style={{ ...linkStyle, color: '#8a857a' }}>Öppna i Cal.com</a>}
                        <span>Bokad {new Date(b.created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                </>)}
            </div>
        </div>
    );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><span style={{ color: '#8fc99a', display: 'flex' }}>{icon}</span><span style={{ minWidth: 0 }}>{children}</span></div>;
}
function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ borderTop: '1px solid #232823', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9c968a', marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{children}</div>
        </div>
    );
}
const dt: React.CSSProperties = { color: '#9c968a' };
const dd: React.CSSProperties = { margin: 0 };
const linkStyle: React.CSSProperties = { color: '#cfe3cf', textDecoration: 'underline', textUnderlineOffset: 2 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(80,150,90,0.25)', border: '1px solid #3f6b47', color: '#dff2e0', padding: '7px 12px', borderRadius: 6, fontSize: 13, textDecoration: 'none' };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#e8e4d8', padding: '7px 12px', borderRadius: 6, fontSize: 13, textDecoration: 'none' };
