import { useEffect, useState, useCallback, useMemo } from 'react';
import type { Activity } from '../api';
import { fetchActivities } from '../api';
import { SegmentedControl } from './SegmentedControl';
import { focusContact } from '../navigation/uiActions';

/* ─── Filter Configuration ─── */
interface FilterConfig {
    key: string;
    label: string;
    icon: string;
    /** Maps to server-side query params */
    query: { event_type?: string; severity?: string };
}

const FILTERS: FilterConfig[] = [
    { key: 'all', label: 'Alla', icon: '📊', query: {} },
    { key: 'tool', label: 'Tool calls', icon: '🔧', query: { event_type: 'tool_call' } },
    { key: 'response', label: 'Svar', icon: '🤖', query: { event_type: 'chat_responded' } },
    { key: 'message', label: 'Meddelanden', icon: '👤', query: { event_type: 'chat_received' } },
    { key: 'lead', label: 'Leads', icon: '🎯', query: { event_type: 'lead' } },
    { key: 'crm', label: 'Försäljning', icon: '🤝', query: { event_type: 'crm' } },
    { key: 'todo', label: 'Att göra', icon: '✅', query: { event_type: 'todo' } },
    { key: 'warn', label: 'Varningar', icon: '🟠', query: { severity: 'warn' } },
    { key: 'error', label: 'Fel', icon: '⚠️', query: { severity: 'error' } },
    { key: 'cron', label: 'Cron', icon: '🔄', query: { event_type: 'cron_trigger' } },
];

const SEGMENTS = FILTERS.map(f => ({
    key: f.key,
    label: `${f.icon} ${f.label}`,
}));

/* ─── Type icons for the event_type column ─── */
const EVENT_TYPE_ICONS: Record<string, string> = {
    tool_call: '🔧',
    chat_responded: '🤖',
    chat_received: '👤',
    task_proposed: '📋',
    run_dispatched: '🚀',
    run_completed: '✅',
    run_failed: '❌',
    run_timeout: '⏱',
    cron_trigger: '🔄',
    heartbeat: '💓',
    lead: '🎯',
    crm: '🤝',
    todo: '✅',
};

/** Kort, läsbar sammanfattning av details för CRM/todo-rader (kontakt · flytt · notis). */
function summarize(a: Activity): string {
    const d = (a.details || {}) as Record<string, unknown>;
    const parts: string[] = [];
    const name = d.contact_name ?? d.contact ?? d.kort;
    if (name) parts.push(String(name));
    if (d.from && d.to) parts.push(`${d.from} → ${d.to}`);
    else if (d.auto_moved) parts.push(String(d.auto_moved));
    if (d.note) parts.push(String(d.note));
    return parts.join(' · ');
}

/** Nycklar som inte tillför något i modalen: de står redan i huvudet eller är rena id:n. */
const DOLDA_DETALJER = new Set(['contact_id', 'customer_id', 'agent', 'action', 'event_type', 'severity']);

/** Ett värde ur details, i läsbar form. Objekt och listor får JSON, resten text. */
function detaljVarde(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const NYCKEL_ETIKETT: Record<string, string> = {
    reason: 'Skäl', channel: 'Kanal', lead_id: 'Lead', via: 'Via', to: 'Till', from: 'Från',
    error: 'Felmeddelande', message: 'Meddelande', kind: 'Typ', note: 'Notis',
    contact_name: 'Kontakt', status: 'Status', intent: 'Avsikt', count: 'Antal',
};

const SEVERITY_ORD: Record<string, string> = { error: 'Fel', warn: 'Varning', info: 'Info' };

interface Props {
    selectedCustomerId: string | null;
    /** Styr filtret utifrån, t.ex. när någon klickar på Fel- eller Varningsrutan. */
    filter?: string;
    onFilterChange?: (key: string) => void;
}

export function ActivityLog({ selectedCustomerId, filter, onFilterChange }: Props) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [internFilter, setInternFilter] = useState('all');
    const [vald, setVald] = useState<Activity | null>(null);
    const activeFilter = filter ?? internFilter;
    const setActiveFilter = useCallback((k: string) => {
        setInternFilter(k);
        onFilterChange?.(k);
    }, [onFilterChange]);

    /* Resolve current filter config */
    const currentFilter = useMemo(
        () => FILTERS.find(f => f.key === activeFilter) || FILTERS[0],
        [activeFilter]
    );

    const loadActivities = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchActivities({
                limit: 80,
                offset: 0,
                customer_id: selectedCustomerId || undefined,
                ...currentFilter.query,
            });
            setActivities(data);
        } catch (err) {
            console.error('Failed to fetch activities:', err);
        }
        setLoading(false);
    }, [selectedCustomerId, currentFilter]);

    useEffect(() => {
        void loadActivities();
        const interval = setInterval(() => void loadActivities(), 10000);
        return () => clearInterval(interval);
    }, [loadActivities]);

    /* ─── Helpers ─── */
    const getSeverityClass = (severity: string) =>
        severity === 'error' ? 'severity-dot--error'
            : severity === 'warn' ? 'severity-dot--warn'
                : '';

    const formatTime = (iso: string) =>
        new Date(iso).toLocaleTimeString('sv-SE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });

    const getEventIcon = (eventType: string) =>
        EVENT_TYPE_ICONS[eventType] || '•';

    /* Count errors for badge */
    const errorCount = useMemo(
        () => activities.filter(a => a.severity === 'error').length,
        [activities]
    );

    return (
        <div className="panel activity-panel">
            {/* ─── Filter Bar ─── */}
            <div className="activity-filter-bar">
                <SegmentedControl
                    segments={SEGMENTS}
                    activeKey={activeFilter}
                    onSelect={setActiveFilter}
                />
                {activeFilter === 'all' && errorCount > 0 && (
                    <span className="activity-error-badge">{errorCount} fel</span>
                )}
            </div>

            {/* ─── Activity List ─── */}
            {loading ? (
                <div className="activity-loading">
                    <span className="activity-loading-dot" />
                    <span>Laddar…</span>
                </div>
            ) : (
                <div className="activity-list">
                    {activities.length === 0 ? (
                        <p className="empty">
                            {activeFilter === 'all'
                                ? 'Inga aktiviteter'
                                : `Inga ${currentFilter.label.toLowerCase()} hittades`}
                        </p>
                    ) : (
                        activities.map(a => {
                            return (
                            <div
                                key={a.id}
                                className={`activity-row ${a.severity === 'error' ? 'activity-row--error' : ''}`}
                                onClick={() => setVald(a)}
                                style={{ cursor: 'pointer' }}
                                title="Visa vad händelsen gäller"
                            >
                                <span className="activity-time">{formatTime(a.created_at)}</span>
                                <span
                                    className={`severity-dot ${getSeverityClass(a.severity)}`}
                                    title={a.severity}
                                />
                                <span className="activity-type-icon" title={a.event_type}>
                                    {getEventIcon(a.event_type)}
                                </span>
                                <span className="activity-agent">{a.agent}</span>
                                <span className="activity-action">{a.action}</span>
                                {summarize(a) && (
                                    <span
                                        className="activity-detail"
                                        style={{ opacity: 0.62, marginLeft: 8, fontSize: '0.85em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                        title={summarize(a)}
                                    >
                                        {summarize(a)}
                                    </span>
                                )}
                            </div>
                            );
                        })
                    )}
                </div>
            )}

            {vald && (() => {
                const d = (vald.details || {}) as Record<string, unknown>;
                const kid = typeof d.contact_id === 'string' ? d.contact_id : null;
                const rader = Object.entries(d).filter(([k, v]) =>
                    !DOLDA_DETALJER.has(k) && v !== null && v !== undefined && v !== '');
                return (
                    <div className="act-modal-backdrop" onClick={() => setVald(null)} role="presentation">
                        <div className="act-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
                            <div className="act-modal-head">
                                <div className={`act-modal-sev act-modal-sev--${vald.severity}`}>
                                    {SEVERITY_ORD[vald.severity] ?? vald.severity}
                                </div>
                                <button className="act-modal-close" onClick={() => setVald(null)} aria-label="Stäng">✕</button>
                            </div>

                            <h3 className="act-modal-title">
                                {getEventIcon(vald.event_type)} {vald.action}
                            </h3>
                            <div className="act-modal-sub">
                                {vald.agent} · {vald.event_type} · {new Date(vald.created_at).toLocaleString('sv-SE')}
                            </div>

                            {rader.length === 0 ? (
                                <p className="act-modal-tom">Händelsen bär inga ytterligare uppgifter.</p>
                            ) : (
                                <dl className="act-modal-list">
                                    {rader.map(([k, v]) => (
                                        <div key={k} className="act-modal-rad">
                                            <dt>{NYCKEL_ETIKETT[k] ?? k}</dt>
                                            <dd><pre>{detaljVarde(v)}</pre></dd>
                                        </div>
                                    ))}
                                </dl>
                            )}

                            <div className="act-modal-fot">
                                {vald.autonomy_level && (
                                    <span className="act-modal-tagg">{vald.autonomy_level}</span>
                                )}
                                {kid && (
                                    <button
                                        className="act-modal-knapp"
                                        onClick={() => { setVald(null); focusContact(kid); }}
                                    >
                                        Öppna kontaktkortet
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
