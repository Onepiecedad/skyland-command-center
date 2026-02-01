import { useEffect, useState, useCallback } from 'react';
import type { Task } from '../api';
import { fetchTasks, approveTask } from '../api';

interface Props {
    selectedCustomerId: string | null;
    onApproved: () => void;
}

export function PendingApprovals({ selectedCustomerId, onApproved }: Props) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState<string | null>(null);

    const loadTasks = useCallback(async () => {
        try {
            const data = await fetchTasks({
                limit: 50,
                offset: 0,
                status: 'review',
                customer_id: selectedCustomerId || undefined
            });
            setTasks(data);
        } catch (err) {
            console.error('Failed to fetch tasks:', err);
        }
        setLoading(false);
    }, [selectedCustomerId]);

    useEffect(() => {
        loadTasks();
        // Auto-refresh every 10s
        const interval = setInterval(loadTasks, 10000);
        return () => clearInterval(interval);
    }, [loadTasks]);

    const handleApprove = async (taskId: string) => {
        setApproving(taskId);
        try {
            await approveTask(taskId, 'joakim');
            // Remove from local list immediately
            setTasks(prev => prev.filter(t => t.id !== taskId));
            // Trigger parent refresh
            onApproved();
        } catch (err) {
            console.error('Failed to approve task:', err);
        }
        setApproving(null);
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'urgent': return '#ef4444';
            case 'high': return '#f59e0b';
            case 'normal': return '#3b82f6';
            default: return '#6b7280';
        }
    };

    const formatTime = (iso: string) => {
        return new Date(iso).toLocaleString('sv-SE');
    };

    return (
        <div className="panel">
            <h2>✅ Pending Approvals ({tasks.length})</h2>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <div className="task-list">
                    {tasks.length === 0 ? (
                        <p className="empty">No pending approvals</p>
                    ) : (
                        tasks.map(t => (
                            <div key={t.id} className="task-card">
                                <div className="task-header">
                                    <span className="task-title">{t.title}</span>
                                    <span
                                        className="priority-badge"
                                        style={{ backgroundColor: getPriorityColor(t.priority) }}
                                    >
                                        {t.priority}
                                    </span>
                                </div>
                                <div className="task-meta">
                                    <span>Created: {formatTime(t.created_at)}</span>
                                </div>
                                <button
                                    className="approve-btn"
                                    onClick={() => handleApprove(t.id)}
                                    disabled={approving === t.id}
                                >
                                    {approving === t.id ? 'Approving...' : '✓ Approve'}
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
