import { useGateway } from '../gateway/useGateway';
import { useEffect, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function StatusBar() {
    const gateway = useGateway('agent:skyland:main');
    const [taskCount, setTaskCount] = useState(0);

    const fetchTaskCount = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/v1/tasks?status=in_progress&limit=100`);
            if (!res.ok) return;
            const data = await res.json();
            setTaskCount((data.tasks || []).length);
        } catch { /* silent */ }
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
