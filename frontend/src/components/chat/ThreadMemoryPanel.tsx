import { useState, useCallback, useRef } from 'react';
import { Brain, Search, RefreshCw, Sparkles, Clock } from 'lucide-react';
import type { MemoryEntry } from '../../gateway/gatewaySocket';

interface ThreadMemoryPanelProps {
    memoryEntries: MemoryEntry[];
    onSearch: (query: string) => Promise<void>;
}

function formatMemoryTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function truncateContent(content: string, max = 180): string {
    if (content.length <= max) return content;
    return content.slice(0, max).trimEnd() + '…';
}

export function ThreadMemoryPanel({ memoryEntries, onSearch }: ThreadMemoryPanelProps) {
    const [query, setQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleSearchChange = useCallback((value: string) => {
        setQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            setIsSearching(true);
            await onSearch(value);
            setIsSearching(false);
        }, 400);
    }, [onSearch]);

    const handleRefresh = useCallback(async () => {
        setIsSearching(true);
        await onSearch('');
        setQuery('');
        setIsSearching(false);
    }, [onSearch]);

    return (
        <div className="memory-panel">
            {/* Header */}
            <div className="memory-panel-header">
                <div className="memory-panel-title">
                    <Brain size={14} />
                    <span>Alex Minne</span>
                </div>
                <button
                    className="memory-panel-refresh"
                    onClick={handleRefresh}
                    title="Uppdatera minnen"
                >
                    <RefreshCw size={12} className={isSearching ? 'spinning' : ''} />
                </button>
            </div>

            {/* Search */}
            <div className="memory-search">
                <Search size={12} />
                <input
                    type="text"
                    placeholder="Sök i minnet…"
                    value={query}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="memory-search-input"
                />
            </div>

            {/* Memory List */}
            <div className="memory-list">
                {memoryEntries.length === 0 && !isSearching && (
                    <div className="memory-empty">
                        <Sparkles size={16} />
                        <span>Inga minnen ännu</span>
                        <span className="memory-empty-hint">
                            Alex lagrar viktig kontext automatiskt mellan trådar
                        </span>
                    </div>
                )}

                {isSearching && memoryEntries.length === 0 && (
                    <div className="memory-empty">
                        <RefreshCw size={14} className="spinning" />
                        <span>Söker…</span>
                    </div>
                )}

                {memoryEntries.map((entry, i) => (
                    <div key={entry.id || i} className="memory-entry">
                        <div className="memory-entry-content">
                            {truncateContent(entry.content)}
                        </div>
                        <div className="memory-entry-meta">
                            {entry.source && (
                                <span className="memory-entry-source">{entry.source}</span>
                            )}
                            {entry.timestamp && (
                                <span className="memory-entry-time">
                                    <Clock size={9} />
                                    {formatMemoryTime(entry.timestamp)}
                                </span>
                            )}
                            {entry.score != null && (
                                <span className="memory-entry-score">
                                    {(entry.score * 100).toFixed(0)}%
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
