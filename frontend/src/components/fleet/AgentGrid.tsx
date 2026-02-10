import { useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2, RefreshCcw, Wifi, WifiOff } from 'lucide-react';
import type { AgentData, AgentStatus } from '../../gateway/fleetApi';
import { fetchAgentSessions } from '../../gateway/fleetApi';
import AgentCard from './AgentCard';

type FilterValue = 'all' | 'active' | 'waiting' | 'idle';

interface AgentGridProps {
    onSelectAgent: (agent: AgentData) => void;
    onAgentsLoaded?: (agents: AgentData[]) => void;
}

const FILTER_PILLS: { value: FilterValue; label: string }[] = [
    { value: 'all', label: 'Alla' },
    { value: 'active', label: 'Aktiva' },
    { value: 'waiting', label: 'Väntar' },
    { value: 'idle', label: 'Inaktiva' },
];

const STATUS_ORDER: Record<AgentStatus, number> = {
    active: 0,
    waiting: 1,
    error: 2,
    idle: 3,
};

export default function AgentGrid({ onSelectAgent, onAgentsLoaded }: AgentGridProps) {
    const [agents, setAgents] = useState<AgentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterValue>('all');

    const loadAgents = useCallback(async () => {
        try {
            const data = await fetchAgentSessions();
            setAgents(data);
            setError(null);
            onAgentsLoaded?.(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte hämta agenter');
        } finally {
            setLoading(false);
        }
    }, [onAgentsLoaded]);

    useEffect(() => {
        loadAgents();
        const interval = setInterval(loadAgents, 10000);
        return () => clearInterval(interval);
    }, [loadAgents]);

    // Filter + sort agents
    const displayAgents = useMemo(() => {
        const filtered = filter === 'all'
            ? agents
            : agents.filter(a => a.status === filter);
        return [...filtered].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    }, [agents, filter]);

    // Status counts
    const counts = useMemo(() => {
        const c = { active: 0, waiting: 0, idle: 0, error: 0 };
        agents.forEach(a => { c[a.status]++; });
        return c;
    }, [agents]);

    if (loading) {
        return (
            <section className="agent-grid-container">
                <div className="agent-grid-loading">
                    <Loader2 size={28} className="spin" />
                    <p>Laddar agenter…</p>
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="agent-grid-container">
                <div className="agent-grid-error">
                    <WifiOff size={28} />
                    <p>Gateway offline</p>
                    <span>{error}</span>
                    <button onClick={loadAgents} type="button">
                        <RefreshCcw size={14} /> Försök igen
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section className="agent-grid-container">
            {/* Header row */}
            <div className="agent-grid-header">
                <div className="agent-grid-title">
                    <Wifi size={16} className="status-connected" />
                    <h2>Agent Fleet</h2>
                    <span className="agent-grid-count">{agents.length}</span>
                </div>

                {/* Status summary */}
                <div className="agent-grid-summary">
                    {counts.active > 0 && <span className="summary-badge active">{counts.active} aktiva</span>}
                    {counts.waiting > 0 && <span className="summary-badge waiting">{counts.waiting} väntar</span>}
                    {counts.error > 0 && <span className="summary-badge error">{counts.error} fel</span>}
                    <span className="summary-badge idle">{counts.idle} inaktiva</span>
                </div>
            </div>

            {/* Filter pills */}
            <div className="agent-grid-filters">
                {FILTER_PILLS.map(pill => (
                    <button
                        key={pill.value}
                        type="button"
                        className={`filter-pill ${filter === pill.value ? 'active' : ''}`}
                        onClick={() => setFilter(pill.value)}
                    >
                        {pill.label}
                        {pill.value !== 'all' && (
                            <span className="filter-pill-count">
                                {counts[pill.value as AgentStatus] || 0}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Grid */}
            <div className="agent-grid">
                {displayAgents.length === 0 ? (
                    <div className="agent-grid-empty">
                        <p>Inga agenter matchar filtret</p>
                    </div>
                ) : (
                    displayAgents.map(agent => (
                        <AgentCard
                            key={agent.id}
                            agent={agent}
                            onClick={() => onSelectAgent(agent)}
                        />
                    ))
                )}
            </div>
        </section>
    );
}
