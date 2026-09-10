/**
 * AdsView — annonsfliken för en kund (SCC-58).
 *
 * Avsiktligt INTE en kopia av Meta Business Suite. Bygger vi en sämre version
 * av Metas eget gränssnitt går man in i Metas ändå. Den här vyn visar det
 * Meta inte kan visa: kostnad per lead ställd mot hur många av de leadsen som
 * faktiskt finns i CRM:t. Skiljer sig siffrorna åt tappas något på vägen in,
 * och det syns ingen annanstans.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { fetchWithAuth } from '../api';

interface AdsData {
    customer: string;
    days: number;
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    cost_per_lead: number | null;
    currency: string;
    leads_i_crm: number;
    tapp: number;
    campaigns: Array<{ campaign_name: string | null; spend: number; leads: number; cost_per_lead: number | null }>;
    daily: Array<{ date: string; spend: number; leads: number }>;
    last_fetched_at: string | null;
}

const PERIODER = [7, 14, 30] as const;

function kr(v: number, currency = 'SEK'): string {
    return new Intl.NumberFormat('sv-SE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

function alder(iso: string | null): string {
    if (!iso) return 'okänt';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 60) return `${min} min sedan`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h} h sedan` : `${Math.round(h / 24)} dygn sedan`;
}

export default function AdsView({ slug, adsManagerUrl }: { slug: string; adsManagerUrl?: string | null }) {
    const [days, setDays] = useState<number>(7);
    const [data, setData] = useState<AdsData | null>(null);
    const [fel, setFel] = useState<string | null>(null);
    const [laddar, setLaddar] = useState(false);

    const ladda = useCallback(async () => {
        setLaddar(true); setFel(null);
        try {
            const res = await fetchWithAuth(
                `/api/v1/meta-ads?customer=${encodeURIComponent(slug)}&days=${days}`);
            const json = await res.json();
            if (!res.ok) { setFel(json.error || 'Kunde inte hämta annonsdata.'); setData(null); }
            else setData(json as AdsData);
        } catch {
            setFel('Kunde inte nå backenden.');
        } finally {
            setLaddar(false);
        }
    }, [slug, days]);

    useEffect(() => { void ladda(); }, [ladda]);

    const kort = (etikett: string, varde: string, ton?: string) => (
        <div style={{
            flex: '1 1 140px', minWidth: 140, padding: '14px 16px', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
        }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>{etikett}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: ton ?? '#fff', letterSpacing: '-0.02em' }}>{varde}</div>
        </div>
    );

    if (fel) {
        return (
            <div className="cv-detail-empty-tab">
                <AlertTriangle size={24} strokeWidth={1.5} />
                <p>{fel}</p>
                <button onClick={() => void ladda()} style={{
                    marginTop: 10, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
                    color: 'rgba(255,255,255,0.7)', fontSize: 12,
                }}>Försök igen</button>
            </div>
        );
    }
    if (!data) return <div className="cv-detail-empty-tab"><p>Laddar annonsdata…</p></div>;

    const maxSpend = Math.max(...data.daily.map(d => d.spend), 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {PERIODER.map(p => (
                    <button key={p} onClick={() => setDays(p)} style={{
                        padding: '5px 11px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,' + (days === p ? '0.28' : '0.10') + ')',
                        background: days === p ? 'rgba(255,255,255,0.10)' : 'transparent',
                        color: days === p ? '#fff' : 'rgba(255,255,255,0.55)',
                    }}>{p} dagar</button>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                    Uppdaterad {alder(data.last_fetched_at)}
                </span>
                <button onClick={() => void ladda()} disabled={laddar} title="Hämta om" style={{
                    display: 'flex', alignItems: 'center', padding: 6, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.10)', background: 'transparent',
                    color: 'rgba(255,255,255,0.55)',
                }}><RefreshCw size={13} /></button>
                {adsManagerUrl && (
                    <a href={adsManagerUrl} target="_blank" rel="noreferrer" title="Öppna i Annonshanteraren"
                        style={{ display: 'flex', alignItems: 'center', padding: 6, color: 'rgba(255,255,255,0.55)' }}>
                        <ExternalLink size={13} />
                    </a>
                )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {kort('Spenderat', kr(data.spend, data.currency))}
                {kort('Leads', String(data.leads))}
                {kort('Kostnad per lead',
                    data.cost_per_lead === null ? '—' : kr(data.cost_per_lead, data.currency), '#34d399')}
                {kort('Klick', String(data.clicks))}
            </div>

            {/* Avstämningen — hela poängen med vyn. */}
            <div style={{
                padding: '12px 14px', borderRadius: 12, fontSize: 13,
                border: '1px solid rgba(255,255,255,' + (data.tapp !== 0 ? '0.20' : '0.08') + ')',
                background: data.tapp !== 0 ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.03)',
                color: data.tapp !== 0 ? '#fcd34d' : 'rgba(255,255,255,0.6)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
                {data.tapp !== 0 && <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
                <div>
                    Meta räknar <strong>{data.leads}</strong> leads. CRM:t har <strong>{data.leads_i_crm}</strong>.
                    {data.tapp > 0 && ` ${data.tapp} har inte kommit fram — kontrollera inflödet innan du drar slutsatser om kampanjen.`}
                    {data.tapp < 0 && ` CRM:t har ${-data.tapp} fler, vilket brukar betyda leads från andra källor i samma period.`}
                    {data.tapp === 0 && ' Allt kommer fram.'}
                </div>
            </div>

            {data.campaigns.length > 0 && (
                <div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>KAMPANJER</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {data.campaigns.map(c => (
                            <div key={c.campaign_name ?? '—'} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                                borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)',
                                background: 'rgba(255,255,255,0.02)', fontSize: 13,
                            }}>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {c.campaign_name ?? '—'}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.55)' }}>{kr(c.spend, data.currency)}</span>
                                <span style={{ color: 'rgba(255,255,255,0.55)' }}>{c.leads} leads</span>
                                <span style={{ color: '#34d399', minWidth: 70, textAlign: 'right' }}>
                                    {c.cost_per_lead === null ? '—' : kr(c.cost_per_lead, data.currency)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {data.daily.length > 0 && (
                <div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>PER DYGN</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 90 }}>
                        {data.daily.map(d => (
                            <div key={d.date} title={`${d.date}: ${kr(d.spend, data.currency)}, ${d.leads} leads`}
                                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                <div style={{
                                    width: '100%', borderRadius: '4px 4px 0 0',
                                    height: `${Math.max(4, (d.spend / maxSpend) * 70)}px`,
                                    background: d.leads > 0 ? 'rgba(52,211,153,0.55)' : 'rgba(255,255,255,0.15)',
                                }} />
                                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{d.date.slice(8)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
