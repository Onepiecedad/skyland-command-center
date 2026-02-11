import { useState, useEffect, useCallback } from 'react';
import {
    File,
    Image,
    Video,
    FileText,
    Link as LinkIcon,
    Folder,
    Star,
    Search,
    Upload,
    RefreshCw,
    Filter,
    Grid,
    List,
    MoreVertical,
    Download,
    Trash2,
    Tag,
    Calendar,
    HardDrive,
    Plus,
} from 'lucide-react';

/* ─── Types ─── */
interface ArchiveFile {
    id: string;
    filename: string;
    original_name?: string;
    file_path: string;
    file_type: 'dokument' | 'bilder' | 'video' | 'rapporter' | 'referenser';
    mime_type?: string;
    file_size?: number;
    title?: string;
    description?: string;
    tags: string[];
    source?: string;
    project_id?: string;
    customer_id?: string;
    file_date?: string;
    created_at: string;
    updated_at: string;
    is_archived: boolean;
    is_favorite: boolean;
}

interface ArchiveStats {
    by_type: Record<string, { count: number; size: number; favorites: number }>;
    total: { count: number; size: number; size_formatted: string };
}

/* ─── Config ─── */
const FILE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    dokument: { icon: <FileText size={16} />, label: 'Dokument', color: '#3b82f6' },
    bilder: { icon: <Image size={16} />, label: 'Bilder', color: '#10b981' },
    video: { icon: <Video size={16} />, label: 'Video', color: '#f59e0b' },
    rapporter: { icon: <FileText size={16} />, label: 'Rapporter', color: '#8b5cf6' },
    referenser: { icon: <LinkIcon size={16} />, label: 'Referenser', color: '#ec4899' },
};

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

/* ─── Helpers ─── */
function formatSize(bytes?: number): string {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso?: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('sv-SE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/* ─── Component ─── */
export function ArchiveView() {
    const [files, setFiles] = useState<ArchiveFile[]>([]);
    const [stats, setStats] = useState<ArchiveStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedType, setSelectedType] = useState<string | null>(null);
    const [showFavorites, setShowFavorites] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [selectedFile, setSelectedFile] = useState<ArchiveFile | null>(null);

    // Fetch files
    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (selectedType) params.append('type', selectedType);
            if (search) params.append('search', search);
            if (showFavorites) params.append('favorite', 'true');
            params.append('limit', '100');

            const res = await fetch(`${API_URL}/api/v1/archive/files?${params}`);
            const data = await res.json();
            setFiles(data.files || []);
        } catch (err) {
            console.error('Failed to fetch files:', err);
        } finally {
            setLoading(false);
        }
    }, [selectedType, search, showFavorites]);

    // Fetch stats
    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/api/v1/archive/stats`);
            const data = await res.json();
            setStats(data);
        } catch (err) {
            console.error('Failed to fetch stats:', err);
        }
    }, []);

    // Scan for new files
    const scanFiles = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/v1/archive/scan`);
            const data = await res.json();
            console.log('Scan result:', data);
            await Promise.all([fetchFiles(), fetchStats()]);
        } catch (err) {
            console.error('Scan failed:', err);
        }
    };

    // Toggle favorite
    const toggleFavorite = async (file: ArchiveFile) => {
        try {
            await fetch(`${API_URL}/api/v1/archive/files/${file.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_favorite: !file.is_favorite }),
            });
            await fetchFiles();
        } catch (err) {
            console.error('Failed to toggle favorite:', err);
        }
    };

    // Initial load
    useEffect(() => {
        fetchFiles();
        fetchStats();
    }, [fetchFiles, fetchStats]);

    return (
        <div className="archive-view">
            {/* Header */}
            <div className="archive-header">
                <div className="archive-header-left">
                    <h1>📚 Alex Arkiv</h1>
                    <p className="archive-subtitle">
                        {stats ? `${stats.total.count} filer • ${stats.total.size_formatted}` : 'Laddar...'}
                    </p>
                </div>
                <div className="archive-header-actions">
                    <button className="archive-action-btn" onClick={scanFiles} title="Skanna efter nya filer">
                        <RefreshCw size={16} />
                    </button>
                    <button className="archive-action-btn primary" title="Ladda upp fil">
                        <Upload size={16} />
                    </button>
                </div>
            </div>

            {/* Stats Bar */}
            {stats && (
                <div className="archive-stats-bar">
                    {Object.entries(stats.by_type).map(([type, data]) => {
                        const config = FILE_TYPE_CONFIG[type];
                        return (
                            <div key={type} className="archive-stat-item" style={{ borderColor: config?.color }}>
                                <span className="archive-stat-icon" style={{ color: config?.color }}>
                                    {config?.icon}
                                </span>
                                <span className="archive-stat-label">{config?.label}</span>
                                <span className="archive-stat-count">{data.count}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Filters */}
            <div className="archive-filters">
                <div className="archive-search">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="Sök filer..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="archive-filter-tabs">
                    <button
                        className={`archive-filter-tab ${!selectedType && !showFavorites ? 'active' : ''}`}
                        onClick={() => { setSelectedType(null); setShowFavorites(false); }}
                    >
                        Alla
                    </button>
                    {Object.entries(FILE_TYPE_CONFIG).map(([type, config]) => (
                        <button
                            key={type}
                            className={`archive-filter-tab ${selectedType === type ? 'active' : ''}`}
                            onClick={() => { setSelectedType(type); setShowFavorites(false); }}
                        >
                            {config.icon}
                            <span>{config.label}</span>
                        </button>
                    ))}
                    <button
                        className={`archive-filter-tab ${showFavorites ? 'active' : ''}`}
                        onClick={() => { setShowFavorites(true); setSelectedType(null); }}
                    >
                        <Star size={14} />
                        <span>Favoriter</span>
                    </button>
                </div>

                <div className="archive-view-toggle">
                    <button
                        className={`archive-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => setViewMode('grid')}
                    >
                        <Grid size={16} />
                    </button>
                    <button
                        className={`archive-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                        onClick={() => setViewMode('list')}
                    >
                        <List size={16} />
                    </button>
                </div>
            </div>

            {/* Files */}
            <div className="archive-content">
                {loading ? (
                    <div className="archive-empty">
                        <RefreshCw size={24} className="spinning" />
                        <span>Laddar filer...</span>
                    </div>
                ) : files.length === 0 ? (
                    <div className="archive-empty">
                        <Folder size={32} />
                        <h3>Inga filer hittades</h3>
                        <p>Lägg till filer i ~/Arkiv och klicka på skanna</p>
                        <button className="archive-action-btn primary" onClick={scanFiles}>
                            <RefreshCw size={16} />
                            Skanna nu
                        </button>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="archive-grid">
                        {files.map((file) => {
                            const config = FILE_TYPE_CONFIG[file.file_type];
                            return (
                                <div
                                    key={file.id}
                                    className={`archive-card ${selectedFile?.id === file.id ? 'selected' : ''}`}
                                    onClick={() => setSelectedFile(file)}
                                >
                                    <div className="archive-card-icon" style={{ color: config?.color }}>
                                        {config?.icon || <File size={24} />}
                                    </div>
                                    <div className="archive-card-body">
                                        <h4 className="archive-card-title">{file.title || file.filename}</h4>
                                        <p className="archive-card-meta">
                                            <span>{formatSize(file.file_size)}</span>
                                            <span>{formatDate(file.created_at)}</span>
                                        </p>
                                        {file.tags.length > 0 && (
                                            <div className="archive-card-tags">
                                                {file.tags.slice(0, 3).map((tag, i) => (
                                                    <span key={i} className="archive-tag">{tag}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {file.is_favorite && (
                                        <Star size={14} className="archive-card-favorite" fill="currentColor" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="archive-list">
                        {files.map((file) => {
                            const config = FILE_TYPE_CONFIG[file.file_type];
                            return (
                                <div
                                    key={file.id}
                                    className={`archive-list-item ${selectedFile?.id === file.id ? 'selected' : ''}`}
                                    onClick={() => setSelectedFile(file)}
                                >
                                    <span className="archive-list-icon" style={{ color: config?.color }}>
                                        {config?.icon || <File size={16} />}
                                    </span>
                                    <span className="archive-list-name">{file.title || file.filename}</span>
                                    <span className="archive-list-type">{config?.label}</span>
                                    <span className="archive-list-size">{formatSize(file.file_size)}</span>
                                    <span className="archive-list-date">{formatDate(file.created_at)}</span>
                                    {file.is_favorite && <Star size={14} fill="currentColor" />}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* File Detail Sidebar */}
            {selectedFile && (
                <div className="archive-detail-overlay" onClick={() => setSelectedFile(null)}>
                    <div className="archive-detail" onClick={(e) => e.stopPropagation()}>
                        <button className="archive-detail-close" onClick={() => setSelectedFile(null)}>
                            ×
                        </button>
                        
                        <div className="archive-detail-header">
                            <div className="archive-detail-icon" style={{ color: FILE_TYPE_CONFIG[selectedFile.file_type]?.color }}>
                                {FILE_TYPE_CONFIG[selectedFile.file_type]?.icon || <File size={32} />}
                            </div>
                            <div>
                                <h2>{selectedFile.title || selectedFile.filename}</h2>
                                <p>{FILE_TYPE_CONFIG[selectedFile.file_type]?.label}</p>
                            </div>
                        </div>

                        <div className="archive-detail-body">
                            {selectedFile.description && (
                                <p className="archive-detail-desc">{selectedFile.description}</p>
                            )}

                            <div className="archive-detail-meta">
                                <div className="archive-detail-row">
                                    <HardDrive size={14} />
                                    <span>{formatSize(selectedFile.file_size)}</span>
                                </div>
                                <div className="archive-detail-row">
                                    <Calendar size={14} />
                                    <span>{formatDate(selectedFile.created_at)}</span>
                                </div>
                                {selectedFile.source && (
                                    <div className="archive-detail-row">
                                        <Tag size={14} />
                                        <span>Källa: {selectedFile.source}</span>
                                    </div>
                                )}
                            </div>

                            {selectedFile.tags.length > 0 && (
                                <div className="archive-detail-tags">
                                    <h4>Taggar</h4>
                                    <div className="archive-tags-list">
                                        {selectedFile.tags.map((tag, i) => (
                                            <span key={i} className="archive-tag">{tag}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="archive-detail-actions">
                            <button
                                className={`archive-action-btn ${selectedFile.is_favorite ? 'active' : ''}`}
                                onClick={() => toggleFavorite(selectedFile)}
                            >
                                <Star size={16} fill={selectedFile.is_favorite ? 'currentColor' : 'none'} />
                                {selectedFile.is_favorite ? 'Favorit' : 'Favoritmarkera'}
                            </button>
                            <button className="archive-action-btn">
                                <Download size={16} />
                                Ladda ner
                            </button>
                            <button className="archive-action-btn danger">
                                <Trash2 size={16} />
                                Ta bort
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
