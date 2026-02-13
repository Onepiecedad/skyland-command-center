import { useState, useCallback } from 'react';
import {
    Plus,
    Lightbulb,
    Search,
    Tag,
    Calendar,
    CheckCircle2,
    Circle,
    Clock,
    Archive,
    Trash2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../config';

// Types
interface Idea {
    id: string;
    title: string;
    description?: string;
    category: string;
    status: 'new' | 'in-progress' | 'planned' | 'completed' | 'archived';
    priority: 'low' | 'medium' | 'high' | 'critical';
    tags: string[];
    source?: string;
    created_by: string;
    assigned_to?: string;
    due_date?: string;
    created_at: string;
    updated_at: string;
    completed_at?: string;
    notes?: string;
}

const STATUS_COLORS: Record<string, string> = {
    'new': '#3b82f6',
    'in-progress': '#f59e0b',
    'planned': '#8b5cf6',
    'completed': '#10b981',
    'archived': '#6b7280',
};

const PRIORITY_COLORS: Record<string, string> = {
    'low': '#6b7280',
    'medium': '#3b82f6',
    'high': '#f59e0b',
    'critical': '#ef4444',
};

// API functions
const fetchIdeas = async (filters: Record<string, string>): Promise<Idea[]> => {
    const params = new URLSearchParams(filters);
    const res = await fetch(`${API_URL}/api/v1/ideas?${params}`);
    if (!res.ok) throw new Error('Failed to fetch ideas');
    const data = await res.json();
    return data.ideas;
};

const createIdea = async (idea: Partial<Idea>): Promise<Idea> => {
    const res = await fetch(`${API_URL}/api/v1/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(idea),
    });
    if (!res.ok) throw new Error('Failed to create idea');
    const data = await res.json();
    return data.idea;
};

const updateIdea = async ({ id, ...updates }: Partial<Idea> & { id: string }): Promise<Idea> => {
    const res = await fetch(`${API_URL}/api/v1/ideas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update idea');
    const data = await res.json();
    return data.idea;
};

const deleteIdea = async (id: string): Promise<void> => {
    const res = await fetch(`${API_URL}/api/v1/ideas/${id}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete idea');
};

export function IdeasView() {
    const [filter, setFilter] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const queryClient = useQueryClient();

    // Fetch ideas
    const { data: ideas, isLoading } = useQuery({
        queryKey: ['ideas', filter],
        queryFn: () => fetchIdeas(filter === 'all' ? {} : { status: filter }),
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: createIdea,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ideas'] });
            setShowForm(false);
        },
    });

    const updateMutation = useMutation({
        mutationFn: updateIdea,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
    });

    const deleteMutation = useMutation({
        mutationFn: deleteIdea,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
    });

    const handleCreate = useCallback((e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        createMutation.mutate({
            title: formData.get('title') as string,
            description: formData.get('description') as string,
            category: formData.get('category') as string,
            priority: formData.get('priority') as Idea['priority'],
            tags: (formData.get('tags') as string).split(',').map(t => t.trim()).filter(Boolean),
        });
    }, [createMutation]);

    const filteredIdeas = ideas?.filter(idea =>
        search === '' ||
        idea.title.toLowerCase().includes(search.toLowerCase()) ||
        idea.description?.toLowerCase().includes(search.toLowerCase()) ||
        idea.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
    );

    return (
        <div className="ideas-view">
            {/* Header */}
            <div className="ideas-header">
                <div className="ideas-header-left">
                    <Lightbulb size={24} />
                    <div>
                        <h1>💡 Idéer</h1>
                        <p className="ideas-subtitle">
                            Samla och hantera projektidéer
                        </p>
                    </div>
                </div>
                <button
                    className="ideas-btn-primary"
                    onClick={() => setShowForm(true)}
                >
                    <Plus size={16} />
                    Ny idé
                </button>
            </div>

            {/* Filters */}
            <div className="ideas-filters">
                <div className="ideas-search">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="Sök idéer..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="ideas-filter-tabs">
                    {['all', 'new', 'in-progress', 'planned', 'completed'].map((status) => (
                        <button
                            key={status}
                            className={`ideas-filter-tab ${filter === status ? 'active' : ''}`}
                            onClick={() => setFilter(status)}
                        >
                            {status === 'all' ? 'Alla' :
                                status === 'new' ? 'Nya' :
                                    status === 'in-progress' ? 'Pågående' :
                                        status === 'planned' ? 'Planerade' :
                                            'Klara'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Ideas List */}
            <div className="ideas-content">
                {isLoading ? (
                    <div className="ideas-empty">Laddar idéer...</div>
                ) : filteredIdeas?.length === 0 ? (
                    <div className="ideas-empty">
                        <Lightbulb size={32} />
                        <p>Inga idéer ännu</p>
                        <button
                            className="ideas-btn-primary"
                            onClick={() => setShowForm(true)}
                        >
                            Lägg till första idén
                        </button>
                    </div>
                ) : (
                    <div className="ideas-grid">
                        {filteredIdeas?.map((idea) => (
                            <div key={idea.id} className="idea-card">
                                <div className="idea-card-header">
                                    <div className="idea-status-badge" style={{ background: STATUS_COLORS[idea.status] }}>
                                        {idea.status === 'new' && <Circle size={12} />}
                                        {idea.status === 'in-progress' && <Clock size={12} />}
                                        {idea.status === 'planned' && <Calendar size={12} />}
                                        {idea.status === 'completed' && <CheckCircle2 size={12} />}
                                        {idea.status === 'archived' && <Archive size={12} />}
                                    </div>
                                    <span className="idea-priority" style={{ color: PRIORITY_COLORS[idea.priority] }}>
                                        {idea.priority === 'critical' ? '!!!' : idea.priority === 'high' ? '!!' : '!'}
                                    </span>
                                </div>

                                <h3 className="idea-title">{idea.title}</h3>
                                <p className="idea-description">{idea.description}</p>

                                {idea.tags.length > 0 && (
                                    <div className="idea-tags">
                                        {idea.tags.map((tag) => (
                                            <span key={tag} className="idea-tag">
                                                <Tag size={10} />
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="idea-card-footer">
                                    <span className="idea-category">{idea.category}</span>
                                    <div className="idea-actions">
                                        <button
                                            className="idea-action-btn"
                                            onClick={() => updateMutation.mutate({
                                                id: idea.id,
                                                status: idea.status === 'completed' ? 'new' : 'completed'
                                            })}
                                        >
                                            {idea.status === 'completed' ? <Circle size={14} /> : <CheckCircle2 size={14} />}
                                        </button>
                                        <button
                                            className="idea-action-btn danger"
                                            onClick={() => deleteMutation.mutate(idea.id)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* New Idea Form Modal */}
            {showForm && (
                <div className="ideas-modal-overlay" onClick={() => setShowForm(false)}>
                    <div className="ideas-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Ny idé</h2>
                        <form onSubmit={handleCreate}>
                            <div className="ideas-form-group">
                                <label>Titel</label>
                                <input name="title" required placeholder="Vad är din idé?" />
                            </div>
                            <div className="ideas-form-group">
                                <label>Beskrivning</label>
                                <textarea name="description" rows={3} placeholder="Beskriv idén mer detaljerat..." />
                            </div>
                            <div className="ideas-form-row">
                                <div className="ideas-form-group">
                                    <label>Kategori</label>
                                    <select name="category" defaultValue="general">
                                        <option value="general">Allmän</option>
                                        <option value="content">Content</option>
                                        <option value="tech">Teknik</option>
                                        <option value="business">Business</option>
                                        <option value="personal">Personlig</option>
                                    </select>
                                </div>
                                <div className="ideas-form-group">
                                    <label>Prioritet</label>
                                    <select name="priority" defaultValue="medium">
                                        <option value="low">Låg</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">Hög</option>
                                        <option value="critical">Kritisk</option>
                                    </select>
                                </div>
                            </div>
                            <div className="ideas-form-group">
                                <label>Taggar (kommaseparerade)</label>
                                <input name="tags" placeholder="ai, content, automation..." />
                            </div>
                            <div className="ideas-form-actions">
                                <button type="button" className="ideas-btn-secondary" onClick={() => setShowForm(false)}>
                                    Avbryt
                                </button>
                                <button type="submit" className="ideas-btn-primary" disabled={createMutation.isPending}>
                                    {createMutation.isPending ? 'Sparar...' : 'Spara idé'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
