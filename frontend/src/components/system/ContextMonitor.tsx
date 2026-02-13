import { useState, useEffect, useCallback } from 'react';
import { Activity, DollarSign, AlertTriangle, TrendingUp, Brain, Clock } from 'lucide-react';
import { useGateway } from '../../gateway/useGateway';

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

  // Load pricing config
  useEffect(() => {
    fetch('/config/pricing.json')
      .then(r => r.json())
      .then(setPricing)
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
        <div className="monitor-card">
          <div className="card-icon" style={{ color: '#3b82f6' }}>
            <DollarSign size={20} />
          </div>
          <div className="card-content">
            <span className="card-label">Total Cost</span>
            <span className="card-value">${totalCost.toFixed(4)}</span>
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
      {pricing && (
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
