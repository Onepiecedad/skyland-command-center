import { useEffect, useState } from 'react';
import { fetchPipelines, type Pipeline, type Opportunity, type Contact, type ContactCustom } from '../api';
import PipelineBoard from '../components/PipelineBoard';
import ConversationInbox from '../components/ConversationInbox';
import ContactDetail from '../components/ContactDetail';

function tabBtn(active: boolean): React.CSSProperties {
    return {
        fontSize: 12,
        padding: '4px 12px',
        borderRadius: 8,
        cursor: 'pointer',
        border: active ? '1px solid rgba(52,211,153,0.5)' : '1px solid rgba(255,255,255,0.14)',
        background: active ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.05)',
        color: active ? '#d1fae5' : 'inherit',
        fontWeight: active ? 600 : 400,
    };
}

/**
 * CrmView (F1) — säljtratt + unified inbox.
 * Kanban över vald pipeline (tabbar, inte rullgardin). Sökfältet filtrerar
 * korten live. Klick på ett kort öppnar detaljvyn där kontakten kan
 * redigeras/raderas manuellt. Data ägs helt av SCC — ingen GHL.
 */
export default function CrmView() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Opportunity | null>(null);

    // Rundturen stänger detaljpanelen när berättelsen går vidare
    useEffect(() => {
        const onTourClose = () => setSelected(null);
        window.addEventListener('scc:tour-close-card', onTourClose);
        return () => window.removeEventListener('scc:tour-close-card', onTourClose);
    }, []);
    const [detailTab, setDetailTab] = useState<'detail' | 'inbox'>('detail');
    const [search, setSearch] = useState('');
    const [boardVersion, setBoardVersion] = useState(0);

    useEffect(() => {
        (async () => {
            try {
                const pl = await fetchPipelines();
                setPipelines(pl);
                const def = pl.find((p) => p.is_default) ?? pl[0];
                setActiveId(def?.id ?? null);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Kunde inte hämta pipelines');
            }
            setLoading(false);
        })();
    }, []);

    /** Efter redigering: spegla ändringen i öppna detaljvyn + ladda om boarden. */
    const handleSaved = (c: Contact) => {
        setSelected((prev) => prev
            ? {
                ...prev,
                title: c.name ?? prev.title,
                contact: prev.contact
                    ? { ...prev.contact, name: c.name, email: c.email, phone: c.phone, tags: c.tags, custom: c.custom as ContactCustom }
                    : prev.contact,
            }
            : prev);
        setBoardVersion((v) => v + 1);
    };

    const handleDeleted = () => {
        setSelected(null);
        setBoardVersion((v) => v + 1);
    };

    return (
        <div className="crm-view" style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
            <div className="crm-head" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>🗂️ CRM</h1>
                {pipelines.length > 1 && (
                    <div style={{ display: 'flex', gap: 6 }}>
                        {pipelines.map((p) => (
                            <button key={p.id} onClick={() => { setActiveId(p.id); setSelected(null); }} style={tabBtn(p.id === activeId)}>
                                {p.name}
                            </button>
                        ))}
                    </div>
                )}
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Sök prospekt (namn, IG, mail, tel)…"
                    style={{
                        marginLeft: 'auto', width: 260, padding: '7px 12px', borderRadius: 10, fontSize: 13,
                        border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.25)', color: 'inherit', outline: 'none',
                    }}
                />
            </div>

            {loading && <p style={{ opacity: 0.6 }}>Laddar CRM…</p>}
            {error && <p style={{ color: '#ff6b6b' }}>Fel: {error}</p>}
            {!loading && !error && !activeId && (
                <p style={{ opacity: 0.6 }}>
                    Ingen pipeline finns än. Kör migrationen <code>ticket24_pipelines.sql</code> för att
                    skapa default-pipelinen.
                </p>
            )}

            {activeId && (
                <div className="crm-layout" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div className="crm-board" style={{ flex: 1, minWidth: 0 }}>
                        <PipelineBoard
                            key={`${activeId}:${boardVersion}`}
                            pipelineId={activeId}
                            search={search}
                            onSelectContact={(opp) => { setSelected(opp); setDetailTab('detail'); }}
                        />
                    </div>
                    {selected && selected.contact && (
                        <div className="crm-detail" style={{
                            flex: '0 0 400px', position: 'sticky', top: 16,
                            // Höjdtak + flex-kolumn: utan detta växer panelen obegränsat
                            // och konversationslistan får ingen vägg att scrolla mot.
                            // Offset 210px = panelens topp-position (~197px, under CRM-flik +
                            // sök) + marginal. Tidigare 120px lät panelbotten hamna under
                            // skärmkanten så sista meddelandet klipptes.
                            display: 'flex', flexDirection: 'column',
                            maxHeight: 'calc(100dvh - 225px)',
                        }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                                <button onClick={() => setDetailTab('detail')} style={tabBtn(detailTab === 'detail')}>Detaljer</button>
                                <button onClick={() => setDetailTab('inbox')} style={tabBtn(detailTab === 'inbox')}>Konversation</button>
                                <button
                                    onClick={() => setSelected(null)}
                                    style={{ marginLeft: 'auto', ...tabBtn(false), padding: '4px 10px' }}
                                    aria-label="Stäng"
                                >
                                    ✕
                                </button>
                            </div>
                            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                                {detailTab === 'detail'
                                    ? <ContactDetail opportunity={selected} onSaved={handleSaved} onDeleted={handleDeleted} />
                                    : <ConversationInbox contactId={selected.contact.id} title={selected.title} />}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
