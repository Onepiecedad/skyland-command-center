import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Clock } from 'lucide-react';
import { fetchBoard, moveOpportunity, type BoardColumn, type Opportunity } from '../api';
import {
    SITE_HEALTH_LABEL, SITE_HEALTH_TERMS, NOT_A_LEAD,
    siteHealthOf, hostOf, callGuide, NASTA_REPLIK,
} from './siteHealth';
import { ScrollStrip } from './ScrollStrip';

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

/** Bara det som faktiskt är en affärssignal. MOVED är städning, och
 *  UNREACHABLE/MISDIRECT vet vi inte nog om — hålls utanför leadräkningen. */
function hasBrokenSite(opp: Opportunity): boolean {
    const sh = siteHealthOf(opp.contact?.custom);
    return !!sh && !NOT_A_LEAD.has(sh.verdict);
}

/** Har gästen skrivit något? Det är det som skiljer ett svar från ett utskick. */
function harSamtal(opp: Opportunity): boolean {
    const cu = opp.contact?.custom;
    return Number(cu?.ce_messages_in ?? 0) > 0;
}

function matchesSearch(opp: Opportunity, q: string): boolean {
    const cu = opp.contact?.custom;
    const sh = siteHealthOf(opp.contact?.custom);
    const shText = sh
        ? `${sh.verdict} ${SITE_HEALTH_LABEL[sh.verdict] ?? ''} ${SITE_HEALTH_TERMS[sh.verdict] ?? ''} ${sh.evidence ?? ''}`
        : '';
    return [opp.title, opp.contact?.name, opp.contact?.email, opp.contact?.phone,
            cu?.instagram, cu?.website, cu?.address, cu?.ce_message, cu?.ce_country, shText]
        .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

/**
 * Cold Experience-leads är gäster, inte företag. De har inga betyg, ingen
 * Instagram och ingen adress. Korten visar i stället vad gästen vill, när,
 * och vad hon skrev. Fälten kommer ur contacts.custom (ce_*), satta av
 * speglingen från ce_leads.
 */
const CE_INTENT: Record<string, string> = {
    yes: '🔥 Vill komma i vinter', info: 'Vill ha info', later: 'Om 1–2 år',
};
const CE_KANAL: Record<string, string> = {
    whatsapp: '💬 WhatsApp', messenger: '📨 Messenger', email: '✉️ Mejl',
    web: '🌐 Webbformulär', other: 'okänd kanal',
};

/** Landskod till flagga. Regional indicator-tecken, alltså A→🇦 osv.
 *  Gustav ska se på en halv sekund om gästen sitter i Sydafrika eller Storbritannien,
 *  för det avgör både tidszon och om samtalet är värt att ringa nu. */
function flagga(kod?: string | null): string {
    const k = (kod ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(k)) return '';
    return String.fromCodePoint(...[...k].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const LAND_NAMN: Record<string, string> = {
    ZA: 'Sydafrika', GB: 'Storbritannien', IE: 'Irland', NL: 'Nederländerna',
    DE: 'Tyskland', PL: 'Polen', AE: 'Förenade Arabemiraten', US: 'USA',
    IN: 'Indien', DK: 'Danmark', CH: 'Schweiz', SE: 'Sverige', NO: 'Norge',
    FI: 'Finland', FR: 'Frankrike', ES: 'Spanien', IT: 'Italien', BE: 'Belgien',
    AT: 'Österrike', AU: 'Australien', CA: 'Kanada',
};

/** Pågår ett samtal just nu? Ett lead som bara fått ett utskick har inga inkommande
 *  meddelanden. Ett levande samtal har gästen skrivit i, och nyligen. */
function ceSamtal(ce: {
    ce_messages_in?: number | null;
    ce_last_message_at?: string | null;
    ce_human_active?: boolean | null;
}): { text: string; farg: string; bg: string } | null {
    const inn = Number(ce.ce_messages_in ?? 0);
    if (!inn) return null;
    const t = ce.ce_last_message_at ? Date.parse(ce.ce_last_message_at) : NaN;
    const min = Number.isNaN(t) ? Infinity : (Date.now() - t) / 60000;
    if (ce.ce_human_active) return { text: '✋ mänsklig i tråden', farg: '#FF9F0A', bg: 'rgba(255,159,10,0.14)' };
    if (min < 30) return { text: '💬 samtal pågår', farg: '#32D74B', bg: 'rgba(50,215,75,0.14)' };
    if (min < 60 * 24) return { text: `💬 svarat · ${inn} meddelanden`, farg: '#5AC8FA', bg: 'rgba(90,200,250,0.12)' };
    return { text: `💬 ${inn} meddelanden`, farg: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)' };
}

function ceTid(iso?: string): string {
    if (!iso) return '';
    const m = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const idag = new Date();
    const sammaDag = d.toDateString() === idag.toDateString();
    const igar = new Date(idag.getTime() - 864e5).toDateString() === d.toDateString();
    const klocka = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    if (sammaDag) return `idag ${klocka}`;
    if (igar) return `igår ${klocka}`;
    return `${d.getDate()} ${m[d.getMonth()]} ${klocka}`;
}

/** Hur gammalt leadet är, i ord. Det är den siffra som avgör om Gustav ska ringa
 *  nu eller inte, och den går inte att räkna ut i huvudet ur ett datum. */
function ceAlder(iso?: string): { text: string; farg: string } | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 60) return { text: min <= 1 ? 'nyss' : `${min} min sedan`, farg: '#32D74B' };
    const tim = Math.round(min / 60);
    if (tim < 24) return { text: `${tim} tim sedan`, farg: '#32D74B' };
    const dag = Math.round(tim / 24);
    if (dag === 1) return { text: '1 dag sedan', farg: '#FF9F0A' };
    if (dag < 7) return { text: `${dag} dagar sedan`, farg: '#FF9F0A' };
    const v = Math.floor(dag / 7);
    return { text: v === 1 ? '1 vecka sedan' : `${v} veckor sedan`, farg: '#FF453A' };
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
    // Samtalsfiltret. "Kontaktad" och "pratar med oss" är två helt olika saker,
    // och med hundra kort i brädet drunknar de tjugo som faktiskt svarat.
    const [baraSamtal, setBaraSamtal] = useState(false);
    const [brokenOnly, setBrokenOnly] = useState(false);
    const [openGuide, setOpenGuide] = useState<Set<string>>(new Set());

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
        if (brokenOnly) filtered = filtered.filter(hasBrokenSite);
        if (baraSamtal) filtered = filtered.filter(harSamtal);
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
            <ScrollStrip className="pl-toolbar" aria-label="Sortering och filter">
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
                    // Samma princip som trasig-webb-knappen: siffran räknas på hela
                    // brädet, annars ändras den av att man klickar på knappen.
                    const alla = columns.flatMap((c) => c.opportunities);
                    const medSamtal = alla.filter(harSamtal).length;
                    if (medSamtal === 0 || medSamtal === alla.length) return null;
                    return (
                        <button
                            data-aktiv={baraSamtal ? 'true' : undefined}
                            onClick={() => setBaraSamtal((v) => !v)}
                            title="Visa bara dem som har svarat, alltså där ett samtal faktiskt är igång"
                            style={{
                                ...toolBtn(baraSamtal), marginLeft: 4,
                                borderColor: baraSamtal ? 'rgba(50,215,75,0.55)' : 'rgba(50,215,75,0.3)',
                                background: baraSamtal ? 'rgba(50,215,75,0.22)' : 'rgba(50,215,75,0.08)',
                            }}
                        >
                            💬 Pågående samtal <span style={{ opacity: 0.7 }}>{medSamtal}</span>
                        </button>
                    );
                })()}
                {(() => {
                    // Räknas på hela brädet, inte på den filtrerade vyn — annars
                    // skulle siffran ändras av att man klickar på knappen.
                    const alla = columns.flatMap((c) => c.opportunities);
                    const broken = alla.filter(hasBrokenSite).length;
                    // Ett filter som träffar allt filtrerar ingenting. På brädet
                    // "Webb — trasiga sajter" är varje kort redan en träff, och
                    // då är knappen bara en siffra som ser ut att gå att klicka på.
                    if (broken === 0 || broken === alla.length) return null;
                    return (
                        <button
                            onClick={() => setBrokenOnly((v) => !v)}
                            title="Visa bara prospekt vars hemsida är trasig, parkerad eller borta"
                            style={{ ...toolBtn(brokenOnly), marginLeft: 4, borderColor: brokenOnly ? 'rgba(255,138,138,0.5)' : 'rgba(255,138,138,0.28)', background: brokenOnly ? 'rgba(255,138,138,0.22)' : 'rgba(255,138,138,0.08)' }}
                        >
                            ● Trasig webb <span style={{ opacity: 0.7 }}>{broken}</span>
                        </button>
                    );
                })()}
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
            </ScrollStrip>
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
                            {opp.contact?.custom?.ce_lead_id && (() => {
                                const ce = opp.contact.custom;
                                const resan = [
                                    ce.ce_adults ? `${ce.ce_adults} vuxna` : null,
                                    ce.ce_travel_when || null,
                                    ce.ce_days ? `${ce.ce_days} dagar` : null,
                                    ce.ce_departure ? `flyg: ${ce.ce_departure}` : null,
                                    ce.ce_price_eur ? `sett €${ce.ce_price_eur}` : null,
                                ].filter(Boolean).join(' · ');
                                const skrev = ce.ce_message || ce.ce_last_inbound;
                                return (
                                    <>
                                        <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                            {ce.ce_intent && (
                                                <span style={{ color: ce.ce_intent === 'yes' ? '#FF9F0A' : 'rgba(255,255,255,0.6)' }}>
                                                    {CE_INTENT[ce.ce_intent] ?? ce.ce_intent}
                                                </span>
                                            )}
                                            <span style={{ opacity: 0.35 }}>·</span>
                                            <span style={{ opacity: 0.6 }}>{(ce.ce_channel && CE_KANAL[ce.ce_channel]) || ce.ce_channel || 'okänd kanal'}</span>
                                            {ce.ce_country && (
                                                <>
                                                    <span style={{ opacity: 0.35 }}>·</span>
                                                    <span
                                                        title={LAND_NAMN[String(ce.ce_country).toUpperCase()] ?? String(ce.ce_country)}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                                            fontWeight: 600, opacity: 1,
                                                            background: 'rgba(255,255,255,0.09)',
                                                            border: '1px solid rgba(255,255,255,0.12)',
                                                            borderRadius: 5, padding: '1px 6px',
                                                        }}
                                                    >
                                                        <span style={{ fontSize: 13, lineHeight: 1 }}>{flagga(ce.ce_country)}</span>
                                                        {String(ce.ce_country).toUpperCase()}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                        {(() => {
                                            const s = ceSamtal(ce);
                                            if (!s) return null;
                                            return (
                                                <div style={{ marginTop: 5 }}>
                                                    <span style={{
                                                        fontSize: 10.5, fontWeight: 600, color: s.farg, background: s.bg,
                                                        borderRadius: 5, padding: '2px 7px', display: 'inline-block',
                                                    }}>{s.text}</span>
                                                </div>
                                            );
                                        })()}
                                        {resan && (
                                            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3 }}>{resan}</div>
                                        )}
                                        {skrev && (
                                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
                                                ”{String(skrev).slice(0, 110)}{String(skrev).length > 110 ? '…' : ''}”
                                            </div>
                                        )}
                                        <div style={{ fontSize: 10.5, marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                            {(() => {
                                                const a = ceAlder(ce.ce_received_at ?? undefined);
                                                const nar = ceTid(ce.ce_received_at ?? undefined);
                                                if (!nar) return <span style={{ opacity: 0.4 }}>tid okänd</span>;
                                                return (
                                                    <span
                                                        title={`Kom in ${new Date(ce.ce_received_at as string).toLocaleString('sv-SE')}`}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                                            padding: '2px 7px', borderRadius: 999, fontWeight: 600,
                                                            background: a ? `${a.farg}1F` : 'rgba(255,255,255,0.07)',
                                                            color: a ? a.farg : 'rgba(255,255,255,0.65)',
                                                        }}
                                                    >
                                                        <Clock size={11} />
                                                        {nar}
                                                        {a && <span style={{ opacity: 0.75, fontWeight: 500 }}>· {a.text}</span>}
                                                    </span>
                                                );
                                            })()}
                                            {ce.ce_answered === false && (
                                                <><span style={{ opacity: 0.3 }}>·</span><span style={{ color: '#FF9F0A' }}>ej svarad</span></>
                                            )}
                                            {ce.ce_callback && (
                                                <><span style={{ opacity: 0.3 }}>·</span><span style={{ opacity: 0.6 }}>ring {ce.ce_callback}</span></>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
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
                                    {opp.contact?.custom?.website && (() => {
                                        const sh = siteHealthOf(opp.contact?.custom);
                                        const broken = !!sh && !NOT_A_LEAD.has(sh.verdict);
                                        // MOVED och UNREACHABLE är inte bevisat trasiga — gula, inte röda.
                                        const tone = broken ? '#ff9a9a' : '#e0b978';
                                        return (
                                            <div>
                                                <a href={opp.contact.custom.website} target="_blank" rel="noreferrer"
                                                   style={{ ...cardLink, ...(sh ? { color: tone, textDecoration: broken ? 'line-through' : 'none', textDecorationColor: 'rgba(255,154,154,0.55)' } : null) }}>
                                                    {sh ? '● ' : ''}Webb · {opp.contact.custom.website.replace(/^https?:\/\/(www\.)?/, '')}
                                                </a>
                                                {sh && (() => {
                                                    const open = openGuide.has(opp.id);
                                                    const site = hostOf(opp.contact?.custom?.website);
                                                    const target = hostOf(sh.final_url);
                                                    const g = callGuide(sh.verdict, site, target);
                                                    return (
                                                        <>
                                                            <div
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setOpenGuide((prev) => {
                                                                        const next = new Set(prev);
                                                                        next.has(opp.id) ? next.delete(opp.id) : next.add(opp.id);
                                                                        return next;
                                                                    });
                                                                }}
                                                                style={{ fontSize: 11, color: tone, opacity: 0.85, marginTop: 1, cursor: 'pointer', userSelect: 'none' }}
                                                                title="Visa diagnos och öppningsreplik"
                                                            >
                                                                {open ? '▾' : '▸'} {SITE_HEALTH_LABEL[sh.verdict]}
                                                            </div>
                                                            {open && (
                                                                <div
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    style={{
                                                                        marginTop: 6, padding: '8px 10px', borderRadius: 8,
                                                                        background: 'rgba(255,255,255,0.04)',
                                                                        border: '1px solid rgba(255,255,255,0.09)',
                                                                        fontSize: 11, lineHeight: 1.45, whiteSpace: 'normal',
                                                                    }}
                                                                >
                                                                    <div style={{ opacity: 0.5, fontSize: 10, letterSpacing: 0.4 }}>DIAGNOS</div>
                                                                    <div style={{ marginBottom: 6 }}>{g.diagnos}</div>

                                                                    <div style={{ opacity: 0.5, fontSize: 10, letterSpacing: 0.4 }}>BEVIS</div>
                                                                    <div style={{ marginBottom: 6, opacity: 0.8 }}>{sh.evidence}</div>

                                                                    {/* Efter två falska positiva 14 sep är detta steg inbyggt,
                                                                        inte något man ska komma ihåg. */}
                                                                    <a href={opp.contact.custom.website} target="_blank" rel="noreferrer"
                                                                       style={{ color: '#9ecbff', textDecoration: 'none', display: 'inline-block', marginBottom: 8 }}>
                                                                        ↗ Öppna sajten och kontrollera själv först
                                                                    </a>

                                                                    <div style={{ opacity: 0.5, fontSize: 10, letterSpacing: 0.4 }}>ÖPPNING</div>
                                                                    <div style={{ fontStyle: 'italic' }}>”{g.oppning}”</div>
                                                                    <div style={{ fontStyle: 'italic', marginTop: 4, opacity: 0.75 }}>”{NASTA_REPLIK}”</div>
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    })()}
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
