import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
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
    const [dropStage, setDropStage] = useState<string | null>(null);
    const [drag, setDrag] = useState<{ oppId: string; title: string; x: number; y: number } | null>(null);
    const colsRef = useRef<HTMLDivElement>(null);
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

    // ── Alex (navigate_ui): öppna ett specifikt kontaktkort. Om boarden inte
    //    hunnit ladda än sparas önskan och försöks igen när kolumnerna kommer. ──
    const pendingContactRef = useRef<string | null>(null);
    const onSelectContactRef = useRef(onSelectContact);
    onSelectContactRef.current = onSelectContact;

    useEffect(() => {
        const tryOpen = (contactId: string, cols: BoardColumn[]): boolean => {
            for (const col of cols) {
                const opp = col.opportunities.find(o => o.contact?.id === contactId);
                if (opp) { onSelectContactRef.current?.(opp); return true; }
            }
            return false;
        };
        const onOpenContact = (e: Event) => {
            const contactId = (e as CustomEvent<{ contactId: string }>).detail?.contactId;
            if (!contactId) return;
            setColumns(cols => {
                if (!tryOpen(contactId, cols)) pendingContactRef.current = contactId;
                return cols;
            });
        };
        window.addEventListener('scc:open-contact', onOpenContact);
        return () => window.removeEventListener('scc:open-contact', onOpenContact);
    }, []);

    // Rundturen: öppna "bästa" kortet (första kolumnen med kort, översta kortet)
    useEffect(() => {
        const onTourOpen = () => {
            setColumns(cols => {
                for (const col of cols) {
                    if (col.opportunities.length > 0) {
                        onSelectContactRef.current?.(col.opportunities[0]);
                        break;
                    }
                }
                return cols;
            });
        };
        window.addEventListener('scc:tour-open-card', onTourOpen);
        return () => window.removeEventListener('scc:tour-open-card', onTourOpen);
    }, []);

    useEffect(() => {
        const pending = pendingContactRef.current;
        if (!pending) return;
        for (const col of columns) {
            const opp = col.opportunities.find(o => o.contact?.id === pending);
            if (opp) {
                pendingContactRef.current = null;
                onSelectContactRef.current?.(opp);
                return;
            }
        }
    }, [columns]);

    // Optimistisk flytt av ett kort till en annan stage.
    const moveCard = useCallback(async (oppId: string, stageId: string) => {
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
            setColumns(prev); // rollback vid fel
        }
    }, [columns]);

    // Pekar-drag från kortets grepp — funkar på touch (mobil) OCH mus (desktop).
    // Greppet har touch-action:none så fingret drar kortet i stället för att skrolla.
    const startDrag = useCallback((e: React.PointerEvent, opp: Opportunity) => {
        e.preventDefault();
        e.stopPropagation();
        const oppId = opp.id;
        const body = document.body.style;
        // Lås markering + scroll så browsern inte kapar gesten (annars markeras text / draget hänger).
        body.setProperty('user-select', 'none');
        body.setProperty('-webkit-user-select', 'none');
        body.setProperty('touch-action', 'none');
        body.setProperty('overflow', 'hidden');
        setDrag({ oppId, title: opp.title, x: e.clientX, y: e.clientY });

        const ptr = { x: e.clientX, y: e.clientY };
        let overStage: string | null = null;

        // Auto-scrolla kolumnlisten när fingret är nära kanten (mobil: mål-kolumnen ligger off-screen).
        let raf = 0;
        const tick = () => {
            const c = colsRef.current;
            if (c) {
                const r = c.getBoundingClientRect();
                const EDGE = 72, SPEED = 16;
                if (ptr.x > r.right - EDGE) c.scrollLeft += SPEED;
                else if (ptr.x < r.left + EDGE) c.scrollLeft -= SPEED;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        const onMove = (ev: PointerEvent) => {
            ev.preventDefault();
            ptr.x = ev.clientX; ptr.y = ev.clientY;
            setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
            const el = document.elementFromPoint(ev.clientX, ev.clientY) as Element | null;
            const colEl = el?.closest('[data-stage-id]') as HTMLElement | null;
            overStage = colEl?.getAttribute('data-stage-id') ?? null;
            setDropStage(overStage);
        };
        const finish = () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            body.removeProperty('user-select');
            body.removeProperty('-webkit-user-select');
            body.removeProperty('touch-action');
            body.removeProperty('overflow');
            if (overStage) void moveCard(oppId, overStage);
            setDrag(null);
            setDropStage(null);
        };
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
    }, [moveCard]);

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
            <div ref={colsRef} className="pl-columns" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            {viewColumns.map((col) => (
                <div
                    key={col.stage.id}
                    className="pl-col"
                    data-stage-id={col.stage.id}
                    style={{
                        ...glassCol,
                        outline: dropStage === col.stage.id ? '2px solid rgba(120,180,255,0.6)' : 'none',
                        transition: 'outline 0.1s',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 600, opacity: 0.85 }}>
                        <span>{col.stage.name}</span>
                        <span style={{ opacity: 0.5 }}>{col.opportunities.length}</span>
                    </div>

                    {col.opportunities.map((opp) => (
                        <div
                            key={opp.id}
                            onClick={() => opp.contact?.id && onSelectContact?.(opp)}
                            style={{
                                position: 'relative',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.10)',
                                borderRadius: 10,
                                padding: '10px 12px',
                                cursor: 'pointer',
                                userSelect: 'none',
                                WebkitUserSelect: 'none',
                                WebkitTouchCallout: 'none',
                                opacity: drag?.oppId === opp.id ? 0.4 : 1,
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                                    <button
                                        onPointerDown={(e) => startDrag(e, opp)}
                                        onClick={(e) => e.stopPropagation()}
                                        title="Dra för att flytta"
                                        aria-label="Dra för att flytta"
                                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.42)', cursor: 'grab', display: 'flex', alignItems: 'center', padding: 6, margin: '-6px -2px -6px -6px', flex: '0 0 auto', touchAction: 'none' }}
                                    >
                                        <GripVertical size={17} />
                                    </button>
                                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opp.title}</div>
                                </div>
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

            {drag && (
                <div style={{ position: 'fixed', left: drag.x + 14, top: drag.y - 12, zIndex: 1000, pointerEvents: 'none', background: 'rgba(28,30,36,0.96)', border: '1px solid rgba(120,180,255,0.5)', borderRadius: 10, padding: '9px 13px', fontSize: 14, fontWeight: 600, color: '#e8e4d8', boxShadow: '0 12px 34px rgba(0,0,0,0.55)', maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {drag.title}
                </div>
            )}
        </div>
    );
}

export default PipelineBoard;
