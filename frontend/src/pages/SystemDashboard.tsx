import { WorkflowHealth } from '../components/system/WorkflowHealth';
import { AgentStatusPanel } from '../components/system/AgentStatusPanel';
import { SystemResources } from '../components/system/SystemResources';
import { GitPanel } from '../components/system/GitPanel';
import { EventFeedPanel } from '../components/system/EventFeedPanel';
import { ErrorRecoveryPanel } from '../components/system/ErrorRecoveryPanel';
import { ContextMonitor } from '../components/system/ContextMonitor';
import { RouteErrorBoundary } from '../components/ErrorBoundary';
import FleetMonitor from './FleetMonitor';

export function SystemDashboard() {
    return (
        <div className="sys-dashboard">
            <div className="sys-dashboard-header">
                <h2 className="sys-dashboard-title">
                    <span className="sys-title-glow">⚡</span>
                    AI System Dashboard
                </h2>
                <p className="sys-dashboard-subtitle">
                    Realtidsöverblick — Workflows · Agenter · Resurser · Context · Events · Fel · Git · Fleet
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

            <GitPanel />

            {/* Fleet — agentflotta, infogad här vid konsolideringen av System + Fleet */}
            <RouteErrorBoundary>
                <FleetMonitor />
            </RouteErrorBoundary>
        </div>
    );
}
