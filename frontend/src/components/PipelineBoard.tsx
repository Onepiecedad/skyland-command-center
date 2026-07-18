import { useCallback, useEffect, useState } from 'react';
import { fetchBoard, moveOpportunity, type BoardColumn, type Opportunity } from '../api';

/**
 * PipelineBoard (SCC-25) — drag-bar kanban över en pipelines stages.
 * Native HTML5 drag-and-drop (inga externa beroenden). Optimistisk flytt:
 * kortet flyttas direkt i UI:t, API-anropet sker i bakgrunden och rullas
 * tillbaka vid fel. Klick på ett kort öppnar kontaktens tråd via onSelectContact.
 */

interface PipelineBoardProps {
    pipelineId: string;
    /** Fritextfilter — matchar titel, kontaktnamn, IG, mail, telefon, adress. */
    search?: string;
    onSelectContact?: (opportunity: Opportunity) => void;
}

function matchesSearch(opp: Opportunity, q: string): boolean {
    const cu = opp.contact?.custom;
    return [opp.title, opp.contact?.name, opp.contact?.email, opp.contact?.phone, cu?.instagram, cu?.website, cu?.address]
        .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

const glassCol: React.CSSProperties = {
    flex: '0 0 260px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 200,
};

function scoreBg(score: number): string {
    if (score >= 85) return '#7ee787'; // tier A
    if (score >= 70) return '#f0c674'; // tier B
    return '#9aa0a6'; // tier C
}

const flowLabel: Record<string, string> = {
    manual: 'Manuell / DM',
    form: 'Formulär',
    online: 'Online-bokning',
};

type Tier = 'A' | 'B' | 'C';

function tierOf(score: number): Tier {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    return 'C';
}

function toolBtn(active: boolean): React.CSSProperties {
    return {
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.14)',
        background: active ? 'rgba(120,180,255,0.22)' : 'rgba(255,255,255,0.05)',
        color: 'inherit',
    };
}

const cardLink: React.CSSProperties = {
    color: '#9ecbff',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    // display:block krävs — på inline-element ignoreras overflow, och en enda
    // lång URL sprängde hela kolumnbredden (Ink Brothers 271-teckens fbclid-URL).
    display: 'block',
    maxWidth: '100%',
};

export function PipelineBoard({ pipelineId, search, onSelectContact }: PipelineBoardProps) {
    const [columns, setColumns] = useState<BoardColumn[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropStage, setDropStage] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<'score' | 'name' | 'ort'>('score');
    const [tierFilter, setTierFilter] = useState<'all' | Tier>('all');

    const load = useCallback(async () => {
        try {
            setColumns(await fetchBoard(pipelineId));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte hämta pipeline');
        }
        setLoading(false);
    }, [pipelineId]);

    useEffect(() => {
        void load();
        // Boarden ska aldrig visa gammal data: hämta om var 60:e sekund och
        // varje gång fliken får fokus igen (Alex/pipelines skriver i bakgrunden).
        const interval = setInterval(() => void load(), 60_000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') void load();
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, [load]);

    const handleDrop = useCallback(async (stageId: string) => {
        const oppId = dragId;
        setDropStage(null);
        setDragId(null);
        if (!oppId) return;

        // Find current column of the dragged opportunity.
        let moved: Opportunity | undefined;
        const prev = columns;
        const next = columns.map((col) => {
            const idx = col.opportunities.findIndex((o) => o.id === oppId);
            if (idx >= 0) moved = col.opportunities[idx];
            return { ...col, opportunities: col.opportunities.filter((o) => o.id !== oppId) };
        });
        if (!moved || moved.stage_id === stageId) return;

        const target = next.find((c) => c.stage.id === stageId);
        if (target) target.opportunities = [{ ...moved, stage_id: stageId }, ...target.opportunities];
        setColumns(next);

        try {
            await moveOpportunity(oppId, stageId);
        } catch {
            setColumns(prev); // rollback on failure
        }
    }, [columns, dragId]);

    if (loading) return <p style={{ opacity: 0.6 }}>Laddar pipeline…</p>;
    if (error) return <p style={{ color: '#ff6b6b' }}>Fel: {error}</p>;

    const q = search?.trim().toLowerCase() ?? '';
    const viewColumns = columns.map((col) => {
        let filtered = tierFilter === 'all'
            ? col.opportunities
            : col.opportunities.filter((o) => {
                const s = o.contact?.custom?.score;
                return typeof s === 'number' && tierOf(s) === tierFilter;
            });
        if (q) filtered = filtered.filter((o) => matchesSearch(o, q));
        const areaOf = (o: Opportunity) => String(o.contact?.custom?.area ?? 'övrigt');
        const ordered = [...filtered].sort((a, b) => {
            if (sortMode === 'score') return (b.contact?.custom?.score ?? -1) - (a.contact?.custom?.score ?? -1);
            if (sortMode === 'ort') {
                const c = areaOf(a).localeCompare(areaOf(b), 'sv');
                return c !== 0 ? c : a.title.localeCompare(b.title, 'sv');
            }
            return a.title.localeCompare(b.title, 'sv');
        });
        return { ...col, opportunities: ordered };
    });

    return (
        <div className="pl-board">
            <div className="pl-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                {([['score', '↓ Score'], ['name', 'A–Ö'], ['ort', 'Ort']] as const).map(([mode, label]) => (
                    <button key={mode} onClick={() => setSortMode(mode)} style={toolBtn(sortMode === mode)}>
                        {label}
                    </button>
                ))}
                <span style={{ opacity: 0.4, fontSize: 12, marginLeft: 4 }}>Tier:</span>
                {(['all', 'A', 'B', 'C'] as const).map((t) => (
                    <button key={t} onClick={() => setTierFilter(t)} style={toolBtn(tierFilter === t)}>
                        {t === 'all' ? 'Alla' : t}
                    </button>
                ))}
                {(() => {
                    const costs = columns.flatMap((c) => c.opportunities)
                        .map((o) => o.contact?.custom?.research_cost_usd)
                        .filter((v): v is number => typeof v === 'number');
                    if (costs.length === 0) return null;
                    const total = costs.reduce((a, b) => a + b, 0);
                    return (
                        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap' }}>
                            Prospektkostnad: ~{(total * 10.5).toFixed(0)} kr totalt · {((total / costs.length) * 10.5).toFixed(2)} kr/kort ({costs.length} mätta)
                        </span>
                    );
                })()}
            </div>
            <div className="pl-columns" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            {viewColumns.map((col) => (
                <div
                    key={col.stage.id}
                    className="pl-col"
                    style={{
                        ...glassCol,
                        outline: dropStage === col.stage.id ? '2px solid rgba(120,180,255,0.6)' : 'none',
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDropStage(col.stage.id); }}
                    onDragLeave={() => setDropStage((s) => (s === col.stage.id ? null : s))}
                    onDrop={() => void handleDrop(col.stage.id)}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 600, opacity: 0.85 }}>
                        <span>{col.stage.name}</span>
                        <span style={{ opacity: 0.5 }}>{col.opportunities.length}</span>
                    </div>

                    {col.opportunities.map((opp) => (
                        <div
                            key={opp.id}
                            draggable
                            onDragStart={() => setDragId(opp.id)}
                            onClick={() => opp.contact?.id && onSelectContact?.(opp)}
                            style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.10)',
                                borderRadius: 10,
                                padding: '10px 12px',
                                cursor: 'grab',
                                opacity: dragId === opp.id ? 0.4 : 1,
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontSize: 14, fontWeight: 600 }}>{opp.title}</div>
                                {typeof opp.contact?.custom?.score === 'number' && (
                                    <span
                                        title="Prospect-score"
                                        style={{
                                            fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                                            background: scoreBg(opp.contact.custom.score), color: '#0b0b0f', whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {opp.contact.custom.score}
                                    </span>
                                )}
                            </div>
                            {opp.contact?.custom?.rating && (
                                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 3 }}>
                                    {opp.contact.custom.rating} ★{opp.contact?.custom?.reviews ? ` (${opp.contact.custom.reviews})` : ''}
                                </div>
                            )}
                            {opp.contact?.custom?.booking_flow && (
                                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span>{flowLabel[opp.contact.custom.booking_flow] ?? opp.contact.custom.booking_flow}</span>
                                    <span style={{ opacity: 0.4 }}>·</span>
                                    <span>{opp.contact?.email ? 'email + IG DM' : 'IG DM'}</span>
                                </div>
                            )}
                            {opp.contact?.custom?.address && (
                                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                                    <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opp.contact.custom.address)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={cardLink}
                                    >
                                        📍 {opp.contact.custom.address}
                                    </a>
                                </div>
                            )}
                            {(opp.contact?.phone || opp.contact?.email || opp.contact?.custom?.website || opp.contact?.custom?.instagram) && (
                                <div
                                    style={{ fontSize: 11, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {opp.contact?.custom?.instagram && (
                                        <a href={`https://instagram.com/${opp.contact.custom.instagram}`} target="_blank" rel="noreferrer" style={cardLink}>
                                            IG · @{opp.contact.custom.instagram}
                                        </a>
                                    )}
                                    {opp.contact?.phone && (
                                        <a href={`tel:${opp.contact.phone.replace(/\s+/g, '')}`} style={cardLink}>Tel · {opp.contact.phone}</a>
                                    )}
                                    {opp.contact?.email && (
                                        <a href={`mailto:${opp.contact.email}`} style={cardLink}>Mail · {opp.contact.email}</a>
                                    )}
                                    {opp.contact?.custom?.website && (
                                        <a href={opp.contact.custom.website} target="_blank" rel="noreferrer" style={cardLink}>Webb · {opp.contact.custom.website.replace(/^https?:\/\/(www\.)?/, '')}</a>
                                    )}
                                </div>
                            )}
                            {typeof opp.value_sek === 'number' && (
                                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                                    {opp.value_sek.toLocaleString('sv-SE')} kr
                                </div>
                            )}
                        </div>
                    ))}

                    {col.opportunities.length === 0 && (
                        <div style={{ fontSize: 12, opacity: 0.35, textAlign: 'center', padding: '16px 0' }}>Tomt</div>
                    )}
                </div>
            ))}
            </div>
        </div>
    );
}

export default PipelineBoard;
