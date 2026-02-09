import { useEffect, useState, useCallback } from 'react';
import type { Task } from '../api';
import { fetchTasks, approveTask, dispatchTask } from '../api';
import { TaskDetail } from './TaskDetail';

interface Props {
    selectedCustomerId: string | null;
    onApproved: () => void;
}

export function PendingApprovals({ selectedCustomerId, onApproved }: Props) {
    const [reviewTasks, setReviewTasks] = useState<Task[]>([]);
    const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState<string | null>(null);
    const [dispatching, setDispatching] = useState<string | null>(null);
    const [dispatchError, setDispatchError] = useState<{ id: string; error: string } | null>(null);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const loadTasks = useCallback(async () => {
        try {
            const [reviewData, assignedData] = await Promise.all([
                fetchTasks({
                    limit: 50,
                    offset: 0,
                    status: 'review',
                    customer_id: selectedCustomerId || undefined
                }),
                fetchTasks({
                    limit: 50,
                    offset: 0,
                    status: 'assigned',
                    customer_id: selectedCustomerId || undefined
                })
            ]);
            setReviewTasks(reviewData);
            setAssignedTasks(assignedData);
            setNow(Date.now());
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

    const handleApprove = async (e: React.MouseEvent, taskId: string) => {
        e.stopPropagation();
        setApproving(taskId);
        try {
            await approveTask(taskId, 'joakim');
            // Remove from review list and reload to catch it in assigned
            setReviewTasks(prev => prev.filter(t => t.id !== taskId));
            await loadTasks();
            onApproved();
        } catch (err) {
            console.error('Failed to approve task:', err);
        }
        setApproving(null);
    };

    const handleDispatch = async (e: React.MouseEvent, taskId: string) => {
        e.stopPropagation();
        setDispatching(taskId);
        setDispatchError(null);

        const result = await dispatchTask(taskId);

        if (!result.success) {
            setDispatchError({ id: taskId, error: result.error || 'Unknown error' });
            setDispatching(null);
            return;
        }

        // Remove from assigned list immediately
        setAssignedTasks(prev => prev.filter(t => t.id !== taskId));
        onApproved();
        setDispatching(null);
    };

    const handleTaskUpdated = (updatedTask: Task) => {
        // Update task in lists if it exists
        setReviewTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
        setAssignedTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));

        // Move between lists if status changed
        if (updatedTask.status !== 'review' && updatedTask.status !== 'assigned') {
            setReviewTasks(prev => prev.filter(t => t.id !== updatedTask.id));
            setAssignedTasks(prev => prev.filter(t => t.id !== updatedTask.id));
        }

        // Update selected task if it's open
        if (selectedTask?.id === updatedTask.id) {
            setSelectedTask(updatedTask);
        }
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

    type MomentumTier = 'fresh' | 'aging' | 'stale' | 'critical';

    const getMomentum = (createdAt: string): { tier: MomentumTier; label: string; hours: number } => {
        const hours = (now - new Date(createdAt).getTime()) / 3600000;
        if (hours < 1) return { tier: 'fresh', label: '⚡ Fresh', hours };
        if (hours < 6) return { tier: 'aging', label: `🕐 ${Math.floor(hours)}h`, hours };
        if (hours < 24) return { tier: 'stale', label: `🔥 ${Math.floor(hours)}h`, hours };
        const days = Math.floor(hours / 24);
        return { tier: 'critical', label: `🚨 ${days}d`, hours };
    };

    const totalCount = reviewTasks.length + assignedTasks.length;

    return (
        <div className="panel">
            <h2>📋 Task Queue ({totalCount})</h2>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <>
                    {/* Review Tasks - Need Approval */}
                    {reviewTasks.length > 0 && (
                        <div className="task-section">
                            <h3>✅ Pending Approval ({reviewTasks.length})</h3>
                            <div className="task-list">
                                {reviewTasks.map(t => (
                                    <div
                                        key={t.id}
                                        className={`task-card clickable momentum-${getMomentum(t.created_at).tier}`}
                                        onClick={() => setSelectedTask(t)}
                                    >
                                        <div className="task-header">
                                            <span className="task-title">{t.title}</span>
                                            <div className="task-badges">
                                                <span className={`momentum-badge momentum-${getMomentum(t.created_at).tier}`}>
                                                    {getMomentum(t.created_at).label}
                                                </span>
                                                <span
                                                    className="priority-badge"
                                                    style={{ backgroundColor: getPriorityColor(t.priority) }}
                                                >
                                                    {t.priority}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="task-meta">
                                            <span>Created: {formatTime(t.created_at)}</span>
                                            <span className="executor-badge">⚡ {t.executor}</span>
                                        </div>
                                        <button
                                            className="approve-btn"
                                            onClick={(e) => handleApprove(e, t.id)}
                                            disabled={approving === t.id}
                                        >
                                            {approving === t.id ? 'Approving...' : '✓ Approve'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Assigned Tasks - Ready to Dispatch */}
                    {assignedTasks.length > 0 && (
                        <div className="task-section">
                            <h3>🚀 Ready to Dispatch ({assignedTasks.length})</h3>
                            <div className="task-list">
                                {assignedTasks.map(t => (
                                    <div
                                        key={t.id}
                                        className={`task-card clickable momentum-${getMomentum(t.created_at).tier}`}
                                        onClick={() => setSelectedTask(t)}
                                    >
                                        <div className="task-header">
                                            <span className="task-title">{t.title}</span>
                                            <div className="task-badges">
                                                <span className={`momentum-badge momentum-${getMomentum(t.created_at).tier}`}>
                                                    {getMomentum(t.created_at).label}
                                                </span>
                                                <span
                                                    className="priority-badge"
                                                    style={{ backgroundColor: getPriorityColor(t.priority) }}
                                                >
                                                    {t.priority}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="task-meta">
                                            <span>Created: {formatTime(t.created_at)}</span>
                                            <span className="executor-badge">⚡ {t.executor}</span>
                                        </div>
                                        <div className="task-actions">
                                            <button
                                                className="dispatch-btn"
                                                onClick={(e) => handleDispatch(e, t.id)}
                                                disabled={dispatching === t.id}
                                            >
                                                {dispatching === t.id ? '⏳ Dispatching...' : '🚀 Dispatch'}
                                            </button>
                                            {dispatchError?.id === t.id && (
                                                <span className="dispatch-error-inline">
                                                    ❌ {dispatchError.error}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {totalCount === 0 && (
                        <p className="empty">No pending tasks</p>
                    )}
                </>
            )}

            {/* Task Detail Modal */}
            {selectedTask && (
                <TaskDetail
                    task={selectedTask}
                    onClose={() => setSelectedTask(null)}
                    onTaskUpdated={handleTaskUpdated}
                />
            )}
        </div>
    );
}
