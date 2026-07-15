/**
 * Attribution-tratt (SCC-36) — opportunity-centrerad vy: källa → kontakt → stage → bokning.
 * Provisionen bygger på att kunna spåra vad en bokning kom ifrån.
 */
import { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, Download } from 'lucide-react';
import { fetchAttributionFunnel, downloadFunnelCsv } from '../../api/system';
import type { FunnelRow } from '../../api/system';

const cellStyle: React.CSSProperties = {
    padding: '0.35rem 0.5rem',
    fontSize: '0.72rem',
    color: 'rgba(255,255,255,0.75)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 160,
};

const headStyle: React.CSSProperties = {
    ...cellStyle,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 600,
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

export function AttributionFunnelPanel() {
    const [rows, setRows] = useState<FunnelRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchAttributionFunnel();
            setRows(data.rows);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Kunde inte nå servern');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const onDownload = async () => {
        setDownloading(true);
        try {
            await downloadFunnelCsv();
        } catch {
            setError('CSV-export misslyckades');
        } finally {
            setDownloading(false);
        }
    };

    const withBooking = rows.filter((r) => r.bookings > 0).length;

    return (
        <div className="sys-panel" style={{ gridColumn: '1 / -1' }}>
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <GitBranch size={15} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">Attribution — tratt</h3>
                    <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)' }}>
                        {rows.length} opportunities · {withBooking} med bokning
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button className="sys-refresh-btn" onClick={onDownload} title="Exportera CSV" disabled={downloading}>
                        <Download size={13} className={downloading ? 'sys-spin' : undefined} />
                    </button>
                    <button className="sys-refresh-btn" onClick={load} title="Uppdatera" disabled={loading}>
                        <RefreshCw size={13} className={loading ? 'sys-spin' : undefined} />
                    </button>
                </div>
            </div>

            {error && <div style={{ fontSize: '0.75rem', color: 'var(--accent-red, #f87171)' }}>{error}</div>}

            {!error && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                <th style={{ ...headStyle, textAlign: 'left' }}>Opportunity</th>
                                <th style={{ ...headStyle, textAlign: 'left' }}>Kontakt</th>
                                <th style={{ ...headStyle, textAlign: 'left' }}>Källa</th>
                                <th style={{ ...headStyle, textAlign: 'left' }}>Pipeline / Stage</th>
                                <th style={{ ...headStyle, textAlign: 'right' }}>Värde (SEK)</th>
                                <th style={{ ...headStyle, textAlign: 'center' }}>Bokningar</th>
                                <th style={{ ...headStyle, textAlign: 'left' }}>Senaste bokningsstatus</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.slice(0, 50).map((r, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                    <td style={{ ...cellStyle, color: '#fff', fontWeight: 500 }} title={r.opportunity}>
                                        {r.opportunity}
                                    </td>
                                    <td style={cellStyle} title={r.email}>{r.contact || '—'}</td>
                                    <td style={cellStyle}>{r.source || '—'}</td>
                                    <td style={cellStyle}>
                                        {r.pipeline}{r.stage ? ` / ${r.stage}` : ''}
                                    </td>
                                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                                        {r.value_sek ? Number(r.value_sek).toLocaleString('sv-SE') : '—'}
                                    </td>
                                    <td
                                        style={{
                                            ...cellStyle,
                                            textAlign: 'center',
                                            color: r.bookings > 0 ? 'var(--accent-green, #34d399)' : 'rgba(255,255,255,0.3)',
                                            fontWeight: r.bookings > 0 ? 600 : 400,
                                        }}
                                    >
                                        {r.bookings}
                                    </td>
                                    <td style={cellStyle}>{r.last_booking_status || '—'}</td>
                                </tr>
                            ))}
                            {!loading && rows.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ ...cellStyle, textAlign: 'center', padding: '1rem' }}>
                                        Inga opportunities ännu
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="sys-panel-footer">
                <span className="sys-footer-text">
                    Visar max 50 rader — CSV-exporten innehåller allt. Kedjan slutar vid bokning (billing = SCC-39).
                </span>
            </div>
        </div>
    );
}
