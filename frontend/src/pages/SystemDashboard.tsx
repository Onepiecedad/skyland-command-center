import { WorkflowHealth } from '../components/system/WorkflowHealth';
import { AgentStatusPanel } from '../components/system/AgentStatusPanel';
import { SystemResources } from '../components/system/SystemResources';
import { GitPanel } from '../components/system/GitPanel';
import { EventFeedPanel } from '../components/system/EventFeedPanel';
import { ErrorRecoveryPanel } from '../components/system/ErrorRecoveryPanel';
import { ContextMonitor } from '../components/system/ContextMonitor';
import { IntegrationsPanel } from '../components/system/IntegrationsPanel';
import { AttributionFunnelPanel } from '../components/system/AttributionFunnelPanel';

export function SystemDashboard() {
    return (
        <div className="sys-dashboard">
            <div className="sys-dashboard-header">
                <h2 className="sys-dashboard-title">
                    <span className="sys-title-glow">⚡</span>
                    AI System Dashboard
                </h2>
                <p className="sys-dashboard-subtitle">
                    Realtidsöverblick — Schemalagda jobb · Agent · Integrationer · Attribution · Resurser · Context · Events · Fel · Git
                </p>
            </div>

            <div className="sys-grid">
                <WorkflowHealth />
                <AgentStatusPanel />
                <SystemResources />
            </div>

            <div className="sys-grid">
                <ContextMonitor />
                <EventFeedPanel />
                <ErrorRecoveryPanel />
            </div>

            <div className="sys-grid">
                <IntegrationsPanel />
                <AttributionFunnelPanel />
            </div>

            <GitPanel />
        </div>
    );
}
