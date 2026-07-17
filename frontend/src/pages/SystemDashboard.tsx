import { useState } from 'react';
import { WorkflowHealth } from '../components/system/WorkflowHealth';
import { AgentStatusPanel } from '../components/system/AgentStatusPanel';
import { SystemResources } from '../components/system/SystemResources';
import { GitPanel } from '../components/system/GitPanel';
import { EventFeedPanel } from '../components/system/EventFeedPanel';
import { ErrorRecoveryPanel } from '../components/system/ErrorRecoveryPanel';
import { ContextMonitor } from '../components/system/ContextMonitor';
import { IntegrationsPanel } from '../components/system/IntegrationsPanel';
import { AttributionFunnelPanel } from '../components/system/AttributionFunnelPanel';

type SysTab = 'core' | 'ops';

/**
 * Höjdbudget-layout: vyn fyller exakt panelens höjd, panelerna fyller sina
 * grid-celler och scrollar internt vid behov. Inget staplas — det som inte
 * hör till överblicken bor under "Drift".
 */
export function SystemDashboard() {
    const [tab, setTab] = useState<SysTab>('core');

    return (
        <div className="sys-dashboard sys-dashboard--fill">
            <div className="sys-dashboard-header sys-dashboard-header--compact">
                <h2 className="sys-dashboard-title">
                    <span className="sys-title-glow">⚡</span>
                    System
                </h2>
                <div className="sys-tab-picker">
                    <button className={tab === 'core' ? 'active' : ''} onClick={() => setTab('core')}>Överblick</button>
                    <button className={tab === 'ops' ? 'active' : ''} onClick={() => setTab('ops')}>Drift</button>
                </div>
            </div>

            {tab === 'core' ? (
                <div className="sys-grid-fill">
                    <WorkflowHealth />
                    <AgentStatusPanel />
                    <IntegrationsPanel />
                    <ContextMonitor />
                    <EventFeedPanel />
                    <ErrorRecoveryPanel />
                </div>
            ) : (
                <div className="sys-grid-fill sys-grid-fill--ops">
                    <SystemResources />
                    <GitPanel />
                    <AttributionFunnelPanel />
                </div>
            )}
        </div>
    );
}
