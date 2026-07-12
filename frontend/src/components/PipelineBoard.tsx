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
    onSelectContact?: (contactId: string, title: string) => void;
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

export function PipelineBoard({ pipelineId, onSelectContact }: PipelineBoardProps) {
    const [columns, setColumns] = useState<BoardColumn[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropStage, setDropStage] = useState<string | null>(null);

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

    return (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            {columns.map((col) => (
                <div
                    key={col.stage.id}
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
                            onClick={() => opp.contact?.id && onSelectContact?.(opp.contact.id, opp.title)}
                            style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.10)',
                                borderRadius: 10,
                                padding: '10px 12px',
                                cursor: 'grab',
                                opacity: dragId === opp.id ? 0.4 : 1,
                            }}
                        >
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{opp.title}</div>
                            {opp.contact && (
                                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                                    {opp.contact.name || '(namnlös)'}{opp.contact.company ? ` · ${opp.contact.company}` : ''}
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
    );
}

export default PipelineBoard;
