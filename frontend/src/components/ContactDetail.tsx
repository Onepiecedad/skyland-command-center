import { useState } from 'react';
import type { Opportunity } from '../api';

/**
 * ContactDetail — full detaljvy för en prospect-kontakt.
 * Visar all insamlad data (score, betyg, kontaktvägar, bokningsflöde, taggar)
 * plus en score-motivering. Data kommer från board-payloadens `opp.contact`.
 */
interface ContactDetailProps {
    opportunity: Opportunity;
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

/** Textblock med kopiera-knapp — för DM-utkast som ska in i Instagram. */
function CopyBlock({ title, text }: { title: string; text: string }) {
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
            <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{text}</div>
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

export function ContactDetail({ opportunity }: ContactDetailProps) {
    const c = opportunity.contact;
    if (!c) return <p style={{ opacity: 0.6, padding: 16 }}>Ingen kontaktdata.</p>;

    const custom = c.custom ?? {};
    const score = typeof custom.score === 'number' ? custom.score : null;
    const ratingNum = custom.rating ? Number(custom.rating.replace(',', '.')) : null;
    const reviewsNum = custom.reviews ? Number(custom.reviews) : 0;
    const channel = c.email ? 'email + IG DM' : 'IG DM';
    const igTags = (c.tags ?? []).filter((t) => !t.startsWith('tier:'));

    return (
        <div style={{ height: '70vh', overflowY: 'auto', padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{opportunity.title}</h2>
                {score !== null && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: scoreBg(score), color: '#0b0b0f' }}>
                        {score} · {tierOf(score)}
                    </span>
                )}
            </div>
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
            <Row label="Status">{opportunity.status}</Row>

            {igTags.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {igTags.map((t) => (
                        <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.07)', opacity: 0.8 }}>{t}</span>
                    ))}
                </div>
            )}

            {(custom.dm_draft || custom.dm_hook) && (() => {
                // dm_hook lagrar öppnare + uppföljning separerade med "---".
                // De är TVÅ olika meddelanden: uppföljningen skickas ENDAST vid svar.
                const [opener, followup] = String(custom.dm_hook ?? '').split(/\n?---\n?/);
                return (
                    <div style={{ marginTop: 18 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Outreach — IG DM</div>
                        {opener && <CopyBlock title="Öppnare (skickas först — INGEN pitch)" text={opener.trim()} />}
                        {followup && <CopyBlock title="Uppföljning (skickas ENDAST vid svar)" text={followup.trim()} />}
                        {custom.dm_hook_source && (
                            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>källa: {custom.dm_hook_source}</div>
                        )}
                        {custom.dm_draft && <CopyBlock title="Äldre utkast (dm_draft)" text={custom.dm_draft} />}
                        {custom.dm_followup && <CopyBlock title="Uppföljning vid svar" text={custom.dm_followup} />}
                    </div>
                );
            })()}

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
