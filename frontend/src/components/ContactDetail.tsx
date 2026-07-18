import { useState } from 'react';
import { updateContact, deleteContact, type Opportunity, type Contact } from '../api';

/**
 * ContactDetail — full detaljvy för en prospect-kontakt.
 * Visar all insamlad data (score, betyg, kontaktvägar, bokningsflöde, taggar)
 * plus en score-motivering. Kortet kan redigeras och raderas manuellt.
 * Data kommer från board-payloadens `opp.contact`.
 */
interface ContactDetailProps {
    opportunity: Opportunity;
    /** Anropas med den uppdaterade kontakten efter sparad redigering. */
    onSaved?: (contact: Contact) => void;
    /** Anropas när kontakten raderats. */
    onDeleted?: () => void;
}

interface EditForm {
    name: string;
    instagram: string;
    phone: string;
    email: string;
    website: string;
    booking_flow: string;
}

type Tier = 'A' | 'B' | 'C';

function tierOf(score: number): Tier {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    return 'C';
}

function scoreBg(score: number): string {
    if (score >= 85) return '#7ee787';
    if (score >= 70) return '#f0c674';
    return '#9aa0a6';
}

const flowLabel: Record<string, string> = {
    manual: 'Manuell / DM',
    form: 'Formulär',
    online: 'Online-bokning',
};

function volumePoints(reviews: number): number {
    if (reviews >= 300) return 35;
    if (reviews >= 150) return 30;
    if (reviews >= 75) return 24;
    if (reviews >= 30) return 17;
    if (reviews >= 10) return 10;
    return 5;
}

function qualityPoints(rating: number | null): number {
    if (rating === null) return 7;
    if (rating >= 5) return 15;
    if (rating >= 4.8) return 13;
    if (rating >= 4.5) return 10;
    return 6;
}

function flowPoints(flow?: string): number {
    if (flow === 'manual') return 50;
    if (flow === 'online') return 12;
    return 35; // form / okänt
}

const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: '7px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: 13,
};
const labelStyle: React.CSSProperties = { opacity: 0.55, whiteSpace: 'nowrap' };
const linkStyle: React.CSSProperties = { color: '#9ecbff', textDecoration: 'none', textAlign: 'right', wordBreak: 'break-all' };

/** Redigerbart textblock med kopiera-knapp — DM:et kan handjusteras före skick. */
function CopyBlock({ title, text, onChange }: { title: string; text: string; onChange?: (v: string) => void }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard kan vara blockerad — ingen krasch
        }
    };
    const rows = Math.max(3, Math.ceil(text.length / 46) + (text.split('\n').length - 1));
    return (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: 'rgba(124,140,255,0.08)', border: '1px solid rgba(124,140,255,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</span>
                <button
                    onClick={copy}
                    style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                        border: '1px solid rgba(124,140,255,0.5)', background: copied ? '#7ee787' : 'rgba(124,140,255,0.15)',
                        color: copied ? '#0b0b0f' : '#aab4ff',
                    }}
                >
                    {copied ? 'Kopierad ✓' : 'Kopiera'}
                </button>
            </div>
            {onChange ? (
                <textarea
                    value={text}
                    rows={rows}
                    onChange={(e) => onChange(e.target.value)}
                    spellCheck={false}
                    style={{
                        width: '100%', boxSizing: 'border-box', resize: 'vertical',
                        fontSize: 13, lineHeight: 1.55, fontFamily: 'inherit', color: 'inherit',
                        background: 'transparent', border: 'none', outline: 'none', padding: 0,
                    }}
                />
            ) : (
                <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{text}</div>
            )}
        </div>
    );
}

/** DM-sektionen: redigerbara öppnare/uppföljning + spara tillbaka till kortet. */
function DmSection({ contactId, dmHook, source, onSaved }: {
    contactId: string; dmHook: string; source?: string | null; onSaved?: (c: Contact) => void;
}) {
    const [initOpener, initFollowup] = dmHook.split(/\n?---\n?/);
    const [opener, setOpener] = useState(initOpener?.trim() ?? '');
    const [followup, setFollowup] = useState(initFollowup?.trim() ?? '');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const dirty = opener !== (initOpener?.trim() ?? '') || followup !== (initFollowup?.trim() ?? '');

    const save = async () => {
        setSaving(true);
        setErr(null);
        try {
            const joined = followup ? `${opener}\n---\n${followup}` : opener;
            const updated = await updateContact(contactId, {
                custom: {
                    dm_hook: joined,
                    dm_hook_source: `${(source ?? '').replace(/ · manuellt justerad.*$/, '')} · manuellt justerad ${new Date().toISOString().slice(0, 10)}`,
                },
            });
            onSaved?.(updated);
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Kunde inte spara');
        }
        setSaving(false);
    };

    return (
        <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Outreach — IG DM</div>
            <CopyBlock title="Öppnare (skickas först — INGEN pitch)" text={opener} onChange={setOpener} />
            {followup !== '' || initFollowup ? (
                <CopyBlock title="Uppföljning (skickas ENDAST vid svar)" text={followup} onChange={setFollowup} />
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                {source && <span style={{ fontSize: 11, opacity: 0.5, flex: 1 }}>källa: {source}</span>}
                {dirty && (
                    <button
                        onClick={() => void save()}
                        disabled={saving}
                        style={{
                            fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 999, cursor: 'pointer',
                            border: '1px solid rgba(52,211,153,0.5)', background: 'rgba(52,211,153,0.18)', color: '#d1fae5',
                            opacity: saving ? 0.5 : 1,
                        }}
                    >
                        {saving ? 'Sparar…' : 'Spara ändringar'}
                    </button>
                )}
            </div>
            {err && <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 4 }}>{err}</div>}
        </div>
    );
}

interface ParsedResearch {
    fakta: string[];
    unik: string | null;
    friktion: string | null;
    kallor: string[];
    rest: string | null;
}

/** Parsar researcherns rapportformat till läsbara sektioner. */
function parseResearch(raw: string): ParsedResearch | null {
    let t = raw
        .replace(/\*\*/g, '')
        .replace(/^[\s\S]*?(?=FAKTA:)/i, '')   // släng preamble ("Här är rapporten…")
        .replace(/^-{3,}\s*$/gm, '')
        .trim();
    if (!/FAKTA:/i.test(t)) return null;       // okänt format → fallback

    const grab = (name: string): string | null => {
        const m = t.match(new RegExp(
            name + ':?\\s*([\\s\\S]*?)(?=\\n\\s*(?:FAKTA|UNIK_DETALJ|BOKNINGSFRIKTION|K[ÄA]LLOR|MALGRUPP_PROBLEM)\\b|$)', 'i'));
        return m ? m[1].trim() : null;
    };
    const fakta = (grab('FAKTA') ?? '')
        .split('\n')
        .map((l) => l.replace(/^[-•]\s*/, '').trim())
        .filter((l) => l.length > 2);
    const kallorText = grab('K[ÄA]LLOR') ?? '';
    const kallor = [...new Set(kallorText.match(/https?:\/\/[^\s,)]+/g) ?? [])];
    return {
        fakta,
        unik: grab('UNIK_DETALJ'),
        friktion: grab('BOKNINGSFRIKTION'),
        kallor,
        rest: null,
    };
}

const sectionLabel: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
    opacity: 0.55, margin: '12px 0 5px',
};

function ResearchNotes({ raw }: { raw: string }) {
    const parsed = parseResearch(raw);
    if (!parsed) {
        // Äldre/oformaterad research: visa som text, men utan markdown-brus
        const cleaned = raw.replace(/\*\*/g, '').replace(/^\|/gm, '').replace(/\|/g, ' · ');
        return (
            <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {cleaned}
            </div>
        );
    }
    return (
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {parsed.fakta.length > 0 && (
                <>
                    <div style={sectionLabel}>Fakta</div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {parsed.fakta.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                </>
            )}
            {parsed.unik && (
                <>
                    <div style={sectionLabel}>Unik detalj</div>
                    <div style={{ padding: '8px 11px', borderRadius: 8, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
                        {parsed.unik}
                    </div>
                </>
            )}
            {parsed.friktion && (
                <>
                    <div style={sectionLabel}>Bokningsfriktion</div>
                    <div style={{ padding: '8px 11px', borderRadius: 8, background: 'rgba(240,198,116,0.07)', border: '1px solid rgba(240,198,116,0.22)' }}>
                        {parsed.friktion}
                    </div>
                </>
            )}
            {parsed.kallor.length > 0 && (
                <>
                    <div style={sectionLabel}>Källor</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {parsed.kallor.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer"
                               style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: 'rgba(158,203,255,0.1)', border: '1px solid rgba(158,203,255,0.25)', color: '#9ecbff', textDecoration: 'none', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {u.replace(/^https?:\/\/(www\.)?/, '')}
                            </a>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={rowStyle}>
            <span style={labelStyle}>{label}</span>
            <span style={{ textAlign: 'right' }}>{children}</span>
        </div>
    );
}

const editInput: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.3)', color: 'inherit', outline: 'none',
};

function EditField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={{ display: 'block', fontSize: 11, opacity: 0.55, marginBottom: 3 }}>{label}</span>
            <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={editInput} />
        </label>
    );
}

export function ContactDetail({ opportunity, onSaved, onDeleted }: ContactDetailProps) {
    const c = opportunity.contact;
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [form, setForm] = useState<EditForm>({ name: '', instagram: '', phone: '', email: '', website: '', booking_flow: '' });
    if (!c) return <p style={{ opacity: 0.6, padding: 16 }}>Ingen kontaktdata.</p>;

    const custom = c.custom ?? {};
    const score = typeof custom.score === 'number' ? custom.score : null;
    const ratingNum = custom.rating ? Number(custom.rating.replace(',', '.')) : null;
    const reviewsNum = custom.reviews ? Number(custom.reviews) : 0;
    const channel = c.email ? 'email + IG DM' : 'IG DM';
    const igTags = (c.tags ?? []).filter((t) => !t.startsWith('tier:'));

    const startEdit = () => {
        setForm({
            name: c.name ?? opportunity.title,
            instagram: custom.instagram ?? '',
            phone: c.phone ?? '',
            email: c.email ?? '',
            website: custom.website ?? '',
            booking_flow: custom.booking_flow ?? '',
        });
        setActionError(null);
        setEditing(true);
    };

    const save = async () => {
        setBusy(true);
        setActionError(null);
        try {
            const updated = await updateContact(c.id, {
                name: form.name.trim() || null,
                phone: form.phone.trim() || null,
                email: form.email.trim() || null,
                website: form.website.trim() || null,
                custom: {
                    instagram: form.instagram.trim().replace(/^@/, '') || null,
                    website: form.website.trim() || null,
                    email: form.email.trim() || null,
                    booking_flow: form.booking_flow || null,
                },
            });
            setEditing(false);
            onSaved?.(updated);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Kunde inte spara');
        }
        setBusy(false);
    };

    const remove = async () => {
        if (!window.confirm(`Radera "${opportunity.title}"? Kortet och dess pipeline-position tas bort permanent.`)) return;
        setBusy(true);
        setActionError(null);
        try {
            await deleteContact(c.id);
            onDeleted?.();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Kunde inte radera');
            setBusy(false);
        }
    };

    const actionBtn = (danger = false): React.CSSProperties => ({
        fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 999, cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.5 : 1,
        border: danger ? '1px solid rgba(255,107,107,0.45)' : '1px solid rgba(255,255,255,0.18)',
        background: danger ? 'rgba(255,107,107,0.12)' : 'rgba(255,255,255,0.07)',
        color: danger ? '#ff9b9b' : 'inherit',
    });

    return (
        <div style={{ height: '70vh', overflowY: 'auto', padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1, minWidth: 0 }}>{opportunity.title}</h2>
                {score !== null && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: scoreBg(score), color: '#0b0b0f' }}>
                        {score} · {tierOf(score)}
                    </span>
                )}
                {!editing && (
                    <>
                        <button onClick={startEdit} disabled={busy} style={actionBtn()}>Redigera</button>
                        <button onClick={() => void remove()} disabled={busy} style={actionBtn(true)}>Radera</button>
                    </>
                )}
            </div>
            {actionError && <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 8 }}>{actionError}</div>}

            {editing && (
                <div style={{ margin: '10px 0 16px', padding: 12, borderRadius: 10, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)' }}>
                    <EditField label="Namn" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
                    <EditField label="Instagram (utan @)" value={form.instagram} onChange={(v) => setForm((f) => ({ ...f, instagram: v }))} placeholder="studionshandle" />
                    <EditField label="Telefon" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
                    <EditField label="Mail" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
                    <EditField label="Webb" value={form.website} onChange={(v) => setForm((f) => ({ ...f, website: v }))} placeholder="https://…" />
                    <label style={{ display: 'block', marginBottom: 12 }}>
                        <span style={{ display: 'block', fontSize: 11, opacity: 0.55, marginBottom: 3 }}>Bokningsflöde</span>
                        <select
                            value={form.booking_flow}
                            onChange={(e) => setForm((f) => ({ ...f, booking_flow: e.target.value }))}
                            style={{ ...editInput, appearance: 'auto' }}
                        >
                            <option value="">Okänt</option>
                            <option value="manual">Manuell / DM</option>
                            <option value="form">Formulär</option>
                            <option value="online">Online-bokning</option>
                        </select>
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => void save()} disabled={busy} style={{ ...actionBtn(), background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.5)', color: '#d1fae5' }}>
                            {busy ? 'Sparar…' : 'Spara'}
                        </button>
                        <button onClick={() => setEditing(false)} disabled={busy} style={actionBtn()}>Avbryt</button>
                    </div>
                </div>
            )}
            {(custom.niche || custom.area) && (
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 14 }}>
                    {[custom.niche, custom.area].filter(Boolean).join(' · ')}
                </div>
            )}

            <Row label="Betyg">{custom.rating ? `${custom.rating} ★${custom.reviews ? ` (${custom.reviews})` : ''}` : '—'}</Row>
            <Row label="Bokningsflöde">{custom.booking_flow ? (flowLabel[custom.booking_flow] ?? custom.booking_flow) : '—'}</Row>
            <Row label="Kanal">{channel}</Row>
            <Row label="Instagram">
                {custom.instagram
                    ? <a href={`https://instagram.com/${custom.instagram}`} target="_blank" rel="noreferrer" style={linkStyle}>@{custom.instagram}</a>
                    : '—'}
            </Row>
            <Row label="Telefon">
                {c.phone ? <a href={`tel:${c.phone.replace(/\s+/g, '')}`} style={linkStyle}>{c.phone}</a> : '—'}
            </Row>
            <Row label="Mail">
                {c.email ? <a href={`mailto:${c.email}`} style={linkStyle}>{c.email}</a> : '—'}
            </Row>
            <Row label="Webb">
                {custom.website
                    ? <a href={custom.website} target="_blank" rel="noreferrer" style={linkStyle}>{custom.website.replace(/^https?:\/\/(www\.)?/, '')}</a>
                    : '—'}
            </Row>
            <Row label="Adress">
                {custom.address
                    ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(custom.address)}`} target="_blank" rel="noreferrer" style={linkStyle}>📍 {custom.address}</a>
                    : '—'}
            </Row>
            <Row label="Status">{opportunity.status}</Row>

            {igTags.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {igTags.map((t) => (
                        <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.07)', opacity: 0.8 }}>{t}</span>
                    ))}
                </div>
            )}

            {custom.dm_hook && (
                <DmSection
                    key={`${c.id}:${custom.dm_hook_source ?? ''}`}
                    contactId={c.id}
                    dmHook={custom.dm_hook}
                    source={custom.dm_hook_source}
                    onSaved={onSaved}
                />
            )}
            {custom.dm_draft && <CopyBlock title="Äldre utkast (dm_draft)" text={custom.dm_draft} />}

            {custom.research_notes && (
                <details style={{ marginTop: 16 }}>
                    <summary style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: 0.85 }}>
                        Research-underlag{custom.research_source ? ` · ${custom.research_source}` : ''}
                    </summary>
                    <div style={{
                        marginTop: 8, padding: 12, borderRadius: 10,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        maxHeight: 380, overflowY: 'auto',
                    }}>
                        <ResearchNotes raw={custom.research_notes} />
                    </div>
                </details>
            )}

            {typeof custom.research_cost_usd === 'number' && (
                <div style={{ marginTop: 10, fontSize: 11.5, opacity: 0.55 }}>
                    Prospektkostnad: ${custom.research_cost_usd.toFixed(3)} (~{(custom.research_cost_usd * 10.5).toFixed(2)} kr)
                    {custom.research_tokens ? ` · ${(custom.research_tokens / 1000).toFixed(0)}k tokens` : ''}
                </div>
            )}

            {score !== null && (
                <div style={{ marginTop: 16, fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 600, opacity: 0.9, marginBottom: 4 }}>Score-motivering</div>
                    Volym {volumePoints(reviewsNum)} (omdömen) · Kvalitet {qualityPoints(ratingNum)} (betyg) · Bokningsflöde {flowPoints(custom.booking_flow)} = <strong>{score}</strong>
                    <div style={{ marginTop: 4, opacity: 0.8 }}>
                        Högre = mer att vinna: många kunder + svagt/manuellt bokningsflöde.
                    </div>
                </div>
            )}
        </div>
    );
}

export default ContactDetail;
