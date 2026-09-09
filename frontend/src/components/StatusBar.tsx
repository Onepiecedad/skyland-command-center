import { useGateway } from '../gateway/useGateway';
import { useEffect, useState, useCallback } from 'react';
import { fetchTasks } from '../api';

export function StatusBar() {
    const gateway = useGateway('agent:skyland:main');
    const [taskCount, setTaskCount] = useState(0);

    // Gick tidigare mot `${API_URL}/api/v1/tasks` med rå fetch. Det gav dubbel
    // prefix i alla lägen där API_URL redan pekade på /api/v1, och saknade
    // auth-huvudet. fetchTasks bygger URL:en och autentiserar på ett ställe.
    const fetchTaskCount = useCallback(async () => {
        try {
            const tasks = await fetchTasks({ status: 'in_progress', limit: 100 });
            setTaskCount(tasks.length);
        } catch { /* tyst */ }
    }, []);

    useEffect(() => {
        fetchTaskCount();
        const interval = setInterval(fetchTaskCount, 30000);
        return () => clearInterval(interval);
    }, [fetchTaskCount]);

    const statusLabel = {
        connected: 'Online',
        connecting: 'Connecting…',
        disconnected: 'Offline',
    }[gateway.status];

    const statusClass = {
        connected: 'status-online',
        connecting: 'status-connecting',
        disconnected: 'status-offline',
    }[gateway.status];

    return (
        <div className="status-bar">
            <div className="status-bar-left">
                <span className={`status-dot-sm ${statusClass}`} />
                <span className="status-bar-label">{statusLabel}</span>
                <span className="status-bar-sep">·</span>
                <span className="status-bar-info">{taskCount} aktiva uppgifter</span>
            </div>
            <div className="status-bar-right">
                <span className="status-bar-gateway">Alex Gateway</span>
                <span className={`status-dot-sm ${statusClass}`} />
            </div>
        </div>
    );
}
