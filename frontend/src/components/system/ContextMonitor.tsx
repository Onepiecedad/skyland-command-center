import { useState, useEffect, useCallback } from 'react';
import { Activity, DollarSign, AlertTriangle, TrendingUp, Brain, Clock } from 'lucide-react';
import { useGateway } from '../../gateway/useGateway';
import { API_BASE, fetchWithAuth } from '../../api';

interface Credits {
  remaining_usd: number | null;
  spent_24h_usd: number;
  spent_7d_usd: number;
  error?: string;
}

/** Färg på saldot: under 2 $ är Alex snart tyst, under 5 $ dags att fylla på. */
function creditsColor(remaining: number | null): string {
  if (remaining === null) return '#94a3b8';
  if (remaining < 2) return '#ef4444';
  if (remaining < 5) return '#f59e0b';
  return '#10b981';
}

interface ModelPricing {
  input: number;
  output: number;
  context_window: number;
}

interface PricingConfig {
  models: Record<string, ModelPricing>;
  alerts: {
    context_threshold_percent: number;
    cost_threshold_dollars: number;
  };
}

interface SessionMetrics {
  sessionKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  contextUsed: number;
  contextLimit: number;
  startTime: Date;
}

export function ContextMonitor() {
  const gateway = useGateway('agent:skyland:main');
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [metrics, setMetrics] = useState<SessionMetrics[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [credits, setCredits] = useState<Credits | null>(null);

  // OpenRouter-saldo: det som faktiskt avgör om Alex kan svara i morgon.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchWithAuth(`${API_BASE}/integrations/openrouter/credits`)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(c => { if (alive) setCredits(c); })
        .catch(() => { if (alive) setCredits({ remaining_usd: null, spent_24h_usd: 0, spent_7d_usd: 0, error: 'nås inte' }); });
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Load pricing config
  useEffect(() => {
    // 6 sep 2026: ett 429/5xx-svar är också JSON ({error}) — det ska inte bli
    // "prislistan" och krascha hela appen på Object.entries(undefined).
    fetch('/config/pricing.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(p => setPricing(p && typeof p === 'object' && p.models ? p : null))
      .catch(err => console.error('Failed to load pricing:', err));
  }, []);

  // Calculate metrics from gateway sessions
  const calculateMetrics = useCallback(() => {
    if (!gateway.sessions || !pricing) return;

    const newMetrics: SessionMetrics[] = [];
    let cost = 0;
    let tokens = 0;

    gateway.sessions.forEach((session) => {
      const model = session.model || 'unknown';
      // GatewaySession has a combined tokenCount; split estimate 60/40 in/out
      const totalTokenCount = session.tokenCount || 0;
      const inputTokens = Math.round(totalTokenCount * 0.6);
      const outputTokens = totalTokenCount - inputTokens;

      // Calculate cost
      let estimatedCost = 0;
      const modelPricing = pricing.models[model];
      if (modelPricing) {
        estimatedCost = (inputTokens * modelPricing.input) + (outputTokens * modelPricing.output);
      }

      const metric: SessionMetrics = {
        sessionKey: session.key,
        model,
        inputTokens,
        outputTokens,
        estimatedCost,
        contextUsed: totalTokenCount,
        contextLimit: modelPricing?.context_window || 128000,
        startTime: new Date(session.lastMessageAt || Date.now()),
      };

      newMetrics.push(metric);
      cost += estimatedCost;
      tokens += totalTokenCount;
    });

    setMetrics(newMetrics);
    setTotalCost(cost);
    setTotalTokens(tokens);
  }, [gateway.sessions, pricing]);

  // Update metrics every 5 seconds
  useEffect(() => {
    calculateMetrics();
    const interval = setInterval(calculateMetrics, 5000);
    return () => clearInterval(interval);
  }, [calculateMetrics]);

  // Get context pressure color
  const getPressureColor = (used: number, limit: number) => {
    const percent = (used / limit) * 100;
    if (percent < 50) return '#10b981'; // Green
    if (percent < 80) return '#f59e0b'; // Yellow
    return '#ef4444'; // Red
  };

  // Get active model info
  const activeSession = metrics[0]; // Most recent
  const contextPercent = activeSession
    ? (activeSession.contextUsed / activeSession.contextLimit) * 100
    : 0;

  return (
    <div className="context-monitor">
      <div className="monitor-header">
        <h3>
          <Activity size={18} />
          Context & Cost Monitor
        </h3>
        <div className={`status-badge ${gateway.status}`}>
          {gateway.status === 'connected' ? 'Live' : 'Offline'}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="monitor-cards">
        <div
          className="monitor-card"
          title={credits?.error
            ? `Saldo kunde inte hämtas: ${credits.error}`
            : `OpenRouter-saldo. Förbrukat senaste dygnet $${(credits?.spent_24h_usd ?? 0).toFixed(2)}, senaste 7 dagarna $${(credits?.spent_7d_usd ?? 0).toFixed(2)}. Sessionens uppskattning: $${totalCost.toFixed(4)}.`}
        >
          <div className="card-icon" style={{ color: creditsColor(credits?.remaining_usd ?? null) }}>
            <DollarSign size={20} />
          </div>
          <div className="card-content">
            <span className="card-label">OpenRouter-saldo</span>
            <span className="card-value" style={{ color: creditsColor(credits?.remaining_usd ?? null) }}>
              {credits?.remaining_usd === null || credits?.remaining_usd === undefined ? '—' : `$${credits.remaining_usd.toFixed(2)}`}
            </span>
            {credits && !credits.error && (
              <span className="card-sub">−${credits.spent_7d_usd.toFixed(2)} / 7 d</span>
            )}
          </div>
        </div>

        <div className="monitor-card">
          <div className="card-icon" style={{ color: '#8b5cf6' }}>
            <Brain size={20} />
          </div>
          <div className="card-content">
            <span className="card-label">Total Tokens</span>
            <span className="card-value">{totalTokens.toLocaleString()}</span>
          </div>
        </div>

        <div className="monitor-card">
          <div className="card-icon" style={{ color: contextPercent > 80 ? '#ef4444' : '#10b981' }}>
            <TrendingUp size={20} />
          </div>
          <div className="card-content">
            <span className="card-label">Context Pressure</span>
            <span className="card-value">{contextPercent.toFixed(1)}%</span>
          </div>
        </div>

        <div className="monitor-card">
          <div className="card-icon" style={{ color: '#f59e0b' }}>
            <Clock size={20} />
          </div>
          <div className="card-content">
            <span className="card-label">Active Sessions</span>
            <span className="card-value">{metrics.length}</span>
          </div>
        </div>
      </div>

      {/* Context Pressure Bar */}
      {activeSession && (
        <div className="pressure-section">
          <div className="pressure-header">
            <span>Current Session Context Usage</span>
            <span style={{ color: getPressureColor(activeSession.contextUsed, activeSession.contextLimit) }}>
              {activeSession.contextUsed.toLocaleString()} / {activeSession.contextLimit.toLocaleString()} tokens
            </span>
          </div>
          <div className="pressure-bar">
            <div
              className="pressure-fill"
              style={{
                width: `${Math.min(contextPercent, 100)}%`,
                backgroundColor: getPressureColor(activeSession.contextUsed, activeSession.contextLimit)
              }}
            />
          </div>
          {contextPercent > 80 && (
            <div className="pressure-alert">
              <AlertTriangle size={14} />
              <span>High context usage! Consider starting a new session.</span>
            </div>
          )}
        </div>
      )}

      {/* Session List */}
      <div className="sessions-section">
        <h4>Active Sessions</h4>
        {metrics.length === 0 ? (
          <div className="empty-state">No active sessions</div>
        ) : (
          <div className="sessions-list">
            {metrics.map((metric) => (
              <div key={metric.sessionKey} className="session-item">
                <div className="session-info">
                  <span className="session-model">{metric.model}</span>
                  <span className="session-time">
                    {metric.startTime.toLocaleTimeString()}
                  </span>
                </div>
                <div className="session-metrics">
                  <span className="metric">
                    {(metric.inputTokens + metric.outputTokens).toLocaleString()} tokens
                  </span>
                  <span className="metric cost">
                    ${metric.estimatedCost.toFixed(4)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Model Pricing Info */}
      {pricing?.models && (
        <div className="pricing-section">
          <h4>Model Pricing (per 1K tokens)</h4>
          <div className="pricing-list">
            {Object.entries(pricing.models).map(([model, config]) => (
              <div key={model} className="pricing-item">
                <span className="model-name">{model.split('/').pop()}</span>
                <span className="price">
                  ${(config.input * 1000).toFixed(2)} / ${(config.output * 1000).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
