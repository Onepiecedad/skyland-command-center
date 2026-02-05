import { RunLogPanel } from '../components/RunLogPanel';

export function SystemMonitor() {
    return (
        <div className="system-monitor-page">
            <div className="system-monitor-header">
                <h2>🖥️ System Monitor</h2>
                <p className="subtitle">Real-time view of all task runs across the system</p>
            </div>
            <RunLogPanel limit={30} pollIntervalMs={5000} />
        </div>
    );
}
