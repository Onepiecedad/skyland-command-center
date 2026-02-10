import { WorkflowHealth } from '../components/system/WorkflowHealth';
import { AgentStatusPanel } from '../components/system/AgentStatusPanel';
import { SystemResources } from '../components/system/SystemResources';
import { ApprovalQueue } from '../components/system/ApprovalQueue';
import { GitPanel } from '../components/system/GitPanel';

export function SystemDashboard() {
    return (
        <div className="sys-dashboard">
            <div className="sys-dashboard-header">
                <h2 className="sys-dashboard-title">
                    <span className="sys-title-glow">⚡</span>
                    AI System Dashboard
                </h2>
                <p className="sys-dashboard-subtitle">
                    Realtidsöverblick — Workflows · Agenter · Resurser · Godkännanden · Git
                </p>
            </div>

            <div className="sys-grid">
                <WorkflowHealth />
                <AgentStatusPanel />
                <SystemResources />
                <ApprovalQueue />
            </div>

            <GitPanel />
        </div>
    );
}

