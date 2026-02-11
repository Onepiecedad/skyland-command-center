import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth, API_BASE } from '../api';

interface DailyCost {
    date: string;
    total: number;
    providers: Record<string, number>;
}

interface ProviderSummary {
    provider: string;
    total: number;
    percentage: number;
    color: string;
}

interface AgentCost {
    agent: string;
    total: number;
    calls: number;
}

interface CostData {
    daily: DailyCost[];
    providers: ProviderSummary[];
    agents: AgentCost[];
    monthTotal: number;
    budget: number;
}

// Provider brand colors for chart segments
const PROVIDER_COLORS: Record<string, string> = {
    openrouter: '#8B5CF6',
    openai: '#10B981',
    exa: '#0A84FF',
    firecrawl: '#FF6B35',
    anthropic: '#D97706',
    other: '#64748B',
};



export function CostCenter() {
    const [timeRange, setTimeRange] = useState<'7d' | '30d'>('30d');
    const [data, setData] = useState<CostData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchCosts = useCallback(async (range: '7d' | '30d') => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_BASE}/costs?range=${range}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            const costData: CostData = await res.json();

            // Ensure provider colors are set (backend may send them, but fallback here)
            costData.providers = costData.providers.map(p => ({
                ...p,
                color: p.color || PROVIDER_COLORS[p.provider] || PROVIDER_COLORS.other,
            }));

            setData(costData);
        } catch (err) {
            console.error('Failed to fetch costs:', err);
            setError(err instanceof Error ? err.message : 'Failed to load cost data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCosts(timeRange);
    }, [timeRange, fetchCosts]);

    // Loading state
    if (loading) {
        return (
            <div className="cost-center">
                <div className="cost-loading">
                    <div className="cost-loading-spinner" />
                    <span>Loading cost data...</span>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="cost-center">
                <div className="panel cost-error">
                    <span className="cost-error-icon">⚠️</span>
                    <span className="cost-error-text">{error}</span>
                    <button className="chart-range-btn" onClick={() => fetchCosts(timeRange)}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // No data (shouldn't happen if API is reachable, but safety net)
    if (!data) return null;

    const displayDaily = timeRange === '7d' ? data.daily.slice(-7) : data.daily;
    const maxDailySpend = Math.max(...displayDaily.map(d => d.total), 0.01); // avoid division by zero
    const budgetUsed = data.budget > 0 ? (data.monthTotal / data.budget) * 100 : 0;
    const todaySpend = data.daily[data.daily.length - 1]?.total || 0;
    const yesterdaySpend = data.daily[data.daily.length - 2]?.total || 0;
    const spendDelta = todaySpend - yesterdaySpend;
    const daysWithData = displayDaily.filter(d => d.total > 0).length || 1;

    return (
        <div className="cost-center">
            {/* Summary Cards */}
            <div className="cost-summary-row">
                <div className="panel cost-summary-card">
                    <span className="cost-label">Month Total</span>
                    <span className="cost-value">${data.monthTotal.toFixed(2)}</span>
                    <div className="budget-bar">
                        <div
                            className={`budget-fill ${budgetUsed > 80 ? 'warning' : ''} ${budgetUsed > 95 ? 'danger' : ''}`}
                            style={{ width: `${Math.min(budgetUsed, 100)}%` }}
                        />
                    </div>
                    <span className="budget-text">{budgetUsed.toFixed(0)}% of ${data.budget} budget</span>
                </div>

                <div className="panel cost-summary-card">
                    <span className="cost-label">Today</span>
                    <span className="cost-value">${todaySpend.toFixed(2)}</span>
                    <span className={`cost-delta ${spendDelta >= 0 ? 'up' : 'down'}`}>
                        {spendDelta >= 0 ? '↑' : '↓'} ${Math.abs(spendDelta).toFixed(2)} vs yesterday
                    </span>
                </div>

                <div className="panel cost-summary-card">
                    <span className="cost-label">Daily Average</span>
                    <span className="cost-value">${(data.monthTotal / daysWithData).toFixed(2)}</span>
                    <span className="cost-sublabel">across {data.providers.length} providers</span>
                </div>

                <div className="panel cost-summary-card">
                    <span className="cost-label">Projected Month</span>
                    <span className={`cost-value ${((data.monthTotal / daysWithData) * 30) > data.budget ? 'over-budget' : ''}`}>
                        ${((data.monthTotal / daysWithData) * 30).toFixed(2)}
                    </span>
                    <span className="cost-sublabel">at current rate</span>
                </div>
            </div>

            {/* Daily Spend Chart */}
            <div className="panel chart-panel">
                <div className="chart-header">
                    <h2>Daily Spend</h2>
                    <div className="chart-controls">
                        <button
                            className={`chart-range-btn ${timeRange === '7d' ? 'active' : ''}`}
                            onClick={() => setTimeRange('7d')}
                        >7 Days</button>
                        <button
                            className={`chart-range-btn ${timeRange === '30d' ? 'active' : ''}`}
                            onClick={() => setTimeRange('30d')}
                        >30 Days</button>
                    </div>
                </div>
                <div className="bar-chart">
                    {displayDaily.map((day, i) => (
                        <div key={day.date} className="bar-column" title={`${day.date}: $${day.total}`}>
                            <div className="bar-stack" style={{ height: `${(day.total / maxDailySpend) * 100}%` }}>
                                {Object.entries(day.providers).map(([provider, amount]) => (
                                    <div
                                        key={provider}
                                        className="bar-segment"
                                        style={{
                                            height: `${day.total > 0 ? (amount / day.total) * 100 : 0}%`,
                                            backgroundColor: PROVIDER_COLORS[provider] || PROVIDER_COLORS.other,
                                        }}
                                    />
                                ))}
                            </div>
                            <span className="bar-label">
                                {timeRange === '7d'
                                    ? new Date(day.date).toLocaleDateString('en', { weekday: 'short' })
                                    : (i % 5 === 0 ? day.date.slice(5) : '')
                                }
                            </span>
                        </div>
                    ))}
                </div>
                <div className="chart-legend">
                    {data.providers.map(p => (
                        <span key={p.provider} className="legend-item">
                            <span className="legend-dot" style={{ backgroundColor: p.color }} />
                            {p.provider}
                        </span>
                    ))}
                </div>
            </div>

            <div className="cost-details-grid">
                {/* By Provider */}
                <div className="panel provider-breakdown">
                    <h2>By Provider</h2>
                    {data.providers.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-icon">📊</span>
                            <p>No cost data yet</p>
                        </div>
                    ) : (
                        <div className="provider-list">
                            {data.providers.map(p => (
                                <div key={p.provider} className="provider-row">
                                    <div className="provider-info">
                                        <span className="provider-dot" style={{ backgroundColor: p.color }} />
                                        <span className="provider-name">{p.provider}</span>
                                    </div>
                                    <div className="provider-bar-container">
                                        <div className="provider-bar" style={{ width: `${p.percentage}%`, backgroundColor: p.color }} />
                                    </div>
                                    <div className="provider-values">
                                        <span className="provider-amount">${p.total.toFixed(2)}</span>
                                        <span className="provider-pct">{p.percentage}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* By Agent */}
                <div className="panel agent-breakdown">
                    <h2>By Agent</h2>
                    {data.agents.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-icon">🤖</span>
                            <p>No agent cost data yet</p>
                        </div>
                    ) : (
                        <div className="agent-cost-list">
                            {data.agents.map((a, i) => (
                                <div key={a.agent} className="agent-cost-row">
                                    <span className="agent-cost-rank">#{i + 1}</span>
                                    <div className="agent-cost-info">
                                        <span className="agent-cost-name">{a.agent}</span>
                                        <span className="agent-cost-calls">{a.calls} API calls</span>
                                    </div>
                                    <span className="agent-cost-amount">${a.total.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
