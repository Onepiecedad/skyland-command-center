import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import {
    Search,
    X,
    LayoutGrid,
    Globe,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Users,
    AlertOctagon,
    ListTodo,
    Mail,
    Phone,
    MapPin,
    FileText,
    HandMetal as Handshake,
    Inbox,
} from 'lucide-react';
import type { Customer } from '../api';
import { fetchCustomers } from '../api';
import { CustomerCard } from '../components/CustomerCard';
import { ActivityLog } from '../components/ActivityLog';
import { PendingApprovals } from '../components/PendingApprovals';

// Lazy-load Realm3D to prevent Three.js version mismatch from crashing entire app
const Realm3D = lazy(() => import('../components/Realm3D').then(m => ({ default: m.Realm3D })));

/* ─── Config ─── */
const STATUS_PRIORITY: Record<string, number> = {
    error: 0,
    warning: 1,
    active: 2,
};

const FILTER_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
    all: { icon: <Users size={13} />, label: 'Alla' },
    error: { icon: <XCircle size={13} />, label: 'Kritisk' },
    warning: { icon: <AlertTriangle size={13} />, label: 'Varning' },
    active: { icon: <CheckCircle2 size={13} />, label: 'Aktiv' },
};

type ViewMode = 'cards' | '3d';
type DetailTab = 'overview' | 'contact' | 'agreements' | 'documents';

const DETAIL_TABS: { key: DetailTab; icon: React.ReactNode; label: string }[] = [
    { key: 'overview', icon: <LayoutGrid size={14} />, label: 'Översikt' },
    { key: 'contact', icon: <Mail size={14} />, label: 'Kontakt' },
    { key: 'agreements', icon: <Handshake size={14} />, label: 'Avtal' },
    { key: 'documents', icon: <FileText size={14} />, label: 'Dokument' },
];

interface Props {
    onTaskCreated: () => void;
}

export function CustomerView({ onTaskCreated }: Props) {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [refreshKey, setRefreshKey] = useState(0);
    const [detailOpen, setDetailOpen] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('cards');
    const [detailTab, setDetailTab] = useState<DetailTab>('overview');

    const loadCustomers = useCallback(async () => {
        try {
            const data = await fetchCustomers();
            setCustomers(data);
        } catch (err) {
            console.error('Failed to fetch customers:', err);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        loadCustomers();
        const interval = setInterval(loadCustomers, 30000);
        return () => clearInterval(interval);
    }, [loadCustomers]);

    const handleRefresh = useCallback(() => {
        setRefreshKey(prev => prev + 1);
    }, []);

    const sortedCustomers = useMemo(() => {
        let result = [...customers];
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.slug.toLowerCase().includes(q)
            );
        }
        if (statusFilter !== 'all') {
            result = result.filter(c => c.status === statusFilter);
        }
        result.sort((a, b) => {
            const pa = STATUS_PRIORITY[a.status] ?? 99;
            const pb = STATUS_PRIORITY[b.status] ?? 99;
            if (pa !== pb) return pa - pb;
            return b.errors_24h - a.errors_24h;
        });
        return result;
    }, [customers, searchQuery, statusFilter]);

    const handleSelectCustomer = (id: string | null) => {
        if (selectedCustomerId === id) {
            setSelectedCustomerId(null);
            setDetailOpen(false);
        } else {
            setSelectedCustomerId(id);
            setDetailOpen(true);
            setDetailTab('overview');
        }
    };

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    const statusCounts = useMemo(() => ({
        all: customers.length,
        error: customers.filter(c => c.status === 'error').length,
        warning: customers.filter(c => c.status === 'warning').length,
        active: customers.filter(c => c.status === 'active').length,
    }), [customers]);

    return (
        <div className="customer-view">
            {/* Toolbar */}
            <div className="cv-toolbar">
                <div className="cv-search-wrap">
                    <Search size={14} className="cv-search-icon" />
                    <input
                        className="cv-search"
                        type="text"
                        placeholder="Sök kund…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="cv-status-filters">
                    {(['all', 'error', 'warning', 'active'] as const).map(status => (
                        <button
                            key={status}
                            className={`cv-filter-btn ${statusFilter === status ? 'active' : ''}`}
                            onClick={() => setStatusFilter(status)}
                        >
                            {FILTER_CONFIG[status].icon}
                            {FILTER_CONFIG[status].label}
                            <span className="cv-filter-count">{statusCounts[status]}</span>
                        </button>
                    ))}
                </div>
                <div className="cv-view-toggle">
                    <button
                        className={`cv-view-btn ${viewMode === 'cards' ? 'active' : ''}`}
                        onClick={() => setViewMode('cards')}
                        title="Kortvy"
                    >
                        <LayoutGrid size={15} />
                    </button>
                    <button
                        className={`cv-view-btn ${viewMode === '3d' ? 'active' : ''}`}
                        onClick={() => setViewMode('3d')}
                        title="3D Realm"
                    >
                        <Globe size={15} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="cv-body">
                {viewMode === 'cards' ? (
                    <div className={`cv-cards-area ${detailOpen ? 'with-detail' : ''}`}>
                        {loading ? (
                            <div className="cv-loading">Laddar kunder…</div>
                        ) : sortedCustomers.length === 0 ? (
                            <div className="cv-empty">
                                <Inbox size={28} strokeWidth={1.5} />
                                <p>Inga kunder matchar filtret</p>
                            </div>
                        ) : (
                            <div className="cv-cards-grid">
                                {sortedCustomers.map(c => (
                                    <CustomerCard
                                        key={c.id}
                                        customer={c}
                                        isSelected={selectedCustomerId === c.id}
                                        onClick={() => handleSelectCustomer(c.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="cv-realm-area">
                        <Suspense fallback={<div className="cv-loading">Laddar 3D…</div>}>
                            <Realm3D
                                selectedCustomerId={selectedCustomerId}
                                onSelectCustomer={handleSelectCustomer}
                            />
                        </Suspense>
                    </div>
                )}

                {/* ─── Tabbed Detail Panel ─── */}
                <div className={`cv-detail-panel ${detailOpen && selectedCustomer ? 'open' : ''}`}>
                    {selectedCustomer && (
                        <>
                            <div className="cv-detail-header">
                                <div className="cv-detail-title-row">
                                    <h2>{selectedCustomer.name}</h2>
                                    <button
                                        className="cv-detail-close"
                                        onClick={() => {
                                            setDetailOpen(false);
                                            setSelectedCustomerId(null);
                                        }}
                                        aria-label="Stäng"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                                <span className="cv-detail-slug">{selectedCustomer.slug}</span>
                            </div>

                            {/* Tab Navigation */}
                            <div className="cv-detail-tabs">
                                {DETAIL_TABS.map(tab => (
                                    <button
                                        key={tab.key}
                                        className={`cv-detail-tab ${detailTab === tab.key ? 'active' : ''}`}
                                        onClick={() => setDetailTab(tab.key)}
                                    >
                                        {tab.icon}
                                        <span>{tab.label}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="cv-detail-content">
                                {detailTab === 'overview' && (
                                    <>
                                        <div className="cv-detail-stats">
                                            <div className="cv-detail-stat">
                                                <AlertOctagon size={14} className="cv-ds-icon cv-ds-error-icon" />
                                                <div className="cv-ds-info">
                                                    <span className="cv-ds-label">Fel (24h)</span>
                                                    <span className="cv-ds-value cv-ds-error">{selectedCustomer.errors_24h}</span>
                                                </div>
                                            </div>
                                            <div className="cv-detail-stat">
                                                <AlertTriangle size={14} className="cv-ds-icon cv-ds-warn-icon" />
                                                <div className="cv-ds-info">
                                                    <span className="cv-ds-label">Varningar (24h)</span>
                                                    <span className="cv-ds-value cv-ds-warn">{selectedCustomer.warnings_24h}</span>
                                                </div>
                                            </div>
                                            <div className="cv-detail-stat">
                                                <ListTodo size={14} className="cv-ds-icon cv-ds-tasks-icon" />
                                                <div className="cv-ds-info">
                                                    <span className="cv-ds-label">Öppna uppgifter</span>
                                                    <span className="cv-ds-value">{selectedCustomer.open_tasks}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="cv-detail-section">
                                            <ActivityLog
                                                key={`act-${refreshKey}`}
                                                selectedCustomerId={selectedCustomerId}
                                            />
                                        </div>

                                        <div className="cv-detail-section">
                                            <PendingApprovals
                                                key={`approvals-${refreshKey}`}
                                                selectedCustomerId={selectedCustomerId}
                                                onApproved={() => {
                                                    handleRefresh();
                                                    onTaskCreated();
                                                }}
                                            />
                                        </div>
                                    </>
                                )}

                                {detailTab === 'contact' && (
                                    <div className="cv-detail-placeholder">
                                        <div className="cv-placeholder-card">
                                            <Phone size={14} />
                                            <span>Telefon</span>
                                            <span className="cv-placeholder-value">—</span>
                                        </div>
                                        <div className="cv-placeholder-card">
                                            <Mail size={14} />
                                            <span>E-post</span>
                                            <span className="cv-placeholder-value">—</span>
                                        </div>
                                        <div className="cv-placeholder-card">
                                            <MapPin size={14} />
                                            <span>Adress</span>
                                            <span className="cv-placeholder-value">—</span>
                                        </div>
                                        <p className="cv-placeholder-note">Kontaktuppgifter hämtas från CRM</p>
                                    </div>
                                )}

                                {detailTab === 'agreements' && (
                                    <div className="cv-detail-empty-tab">
                                        <Handshake size={24} strokeWidth={1.5} />
                                        <p>Inga avtal registrerade</p>
                                    </div>
                                )}

                                {detailTab === 'documents' && (
                                    <div className="cv-detail-empty-tab">
                                        <FileText size={24} strokeWidth={1.5} />
                                        <p>Inga dokument uppladdade</p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
