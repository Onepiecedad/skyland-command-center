import { useEffect, useState } from 'react';
import { fetchPipelines, type Pipeline } from '../api';
import PipelineBoard from '../components/PipelineBoard';
import ConversationInbox from '../components/ConversationInbox';

/**
 * CrmView (F1) — säljtratt + unified inbox.
 * Kanban över default-pipelinen (SCC-25). Klick på ett kort öppnar kontaktens
 * tråd över alla kanaler (SCC-26). Data ägs helt av SCC — ingen GHL.
 */
export default function CrmView() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<{ contactId: string; title: string } | null>(null);

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

    return (
        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>🗂️ CRM</h1>
                {pipelines.length > 1 && activeId && (
                    <select
                        value={activeId}
                        onChange={(e) => setActiveId(e.target.value)}
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px' }}
                    >
                        {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                )}
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
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <PipelineBoard
                            pipelineId={activeId}
                            onSelectContact={(contactId, title) => setSelected({ contactId, title })}
                        />
                    </div>
                    {selected && (
                        <div style={{ flex: '0 0 380px', height: '70vh', position: 'sticky', top: 16 }}>
                            <ConversationInbox
                                contactId={selected.contactId}
                                title={selected.title}
                                onClose={() => setSelected(null)}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
