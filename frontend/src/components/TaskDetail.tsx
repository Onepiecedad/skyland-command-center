import { useEffect, useState, useCallback, useRef } from 'react';
import type { Task } from '../api';
import { fetchTaskChildren, dispatchTask, fetchTask } from '../api';
import { RunLogPanel } from './RunLogPanel';

interface Props {
    task: Task;
    onClose: () => void;
    onTaskUpdated?: (task: Task) => void;
}

export function TaskDetail({ task: initialTask, onClose, onTaskUpdated }: Props) {
    const [task, setTask] = useState<Task>(initialTask);
    const [children, setChildren] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [dispatching, setDispatching] = useState(false);
    const [dispatchError, setDispatchError] = useState<string | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadData = useCallback(async () => {
        const childData = await fetchTaskChildren(task.id);
        setChildren(childData);
    }, [task.id]);

    const refreshTask = useCallback(async () => {
        const updatedTask = await fetchTask(task.id);
        if (updatedTask) {
            setTask(updatedTask);
            onTaskUpdated?.(updatedTask);
        }
        await loadData();
    }, [task.id, loadData, onTaskUpdated]);

    useEffect(() => {
        async function initialLoad() {
            setLoading(true);
            await loadData();
            setLoading(false);
        }
        initialLoad();
    }, [loadData]);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, []);

    const handleDispatch = async () => {
        setDispatching(true);
        setDispatchError(null);

        const result = await dispatchTask(task.id);

        if (!result.success) {
            setDispatchError(result.error || 'Unknown error');
            setDispatching(false);
            return;
        }

        // Update local state immediately
        if (result.task) {
            setTask(result.task);
            onTaskUpdated?.(result.task);
        }
        // Note: Run is now handled by RunLogPanel's own polling

        setDispatching(false);

        // Start short polling (1s × 10) to catch quick completions
        let pollCount = 0;
        pollingRef.current = setInterval(async () => {
            pollCount++;
            await refreshTask();

            // Stop polling if task is no longer in_progress or after 10 polls
            const currentTask = await fetchTask(task.id);
            if (!currentTask || currentTask.status !== 'in_progress' || pollCount >= 10) {
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
            }
        }, 1000);
    };

    const formatTime = (iso: string | null) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('sv-SE');
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return '#22c55e';
            case 'running': case 'in_progress': return '#3b82f6';
            case 'failed': return '#ef4444';
            case 'queued': case 'created': return '#6b7280';
            case 'cancelled': return '#f59e0b';
            case 'timeout': return '#dc2626';
            case 'assigned': return '#8b5cf6';
            case 'review': return '#f59e0b';
            default: return '#6b7280';
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

    const canDispatch = task.status === 'assigned';

    return (
        <div className="task-detail-overlay" onClick={onClose}>
            <div className="task-detail-modal" onClick={(e) => e.stopPropagation()}>
                <div className="task-detail-header">
                    <h2>{task.title}</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                {/* Task Metadata */}
                <div className="task-detail-section">
                    <h3>📋 Metadata</h3>
                    <div className="metadata-grid">
                        <div><strong>ID:</strong> <code>{task.id.slice(0, 8)}...</code></div>
                        <div>
                            <strong>Status:</strong>{' '}
                            <span
                                className="status-badge"
                                style={{ backgroundColor: getStatusColor(task.status) }}
                            >
                                {task.status}
                            </span>
                        </div>
                        <div>
                            <strong>Priority:</strong>{' '}
                            <span className="priority-badge" style={{ backgroundColor: getPriorityColor(task.priority) }}>
                                {task.priority}
                            </span>
                        </div>
                        <div><strong>Executor:</strong> <code>{task.executor}</code></div>
                        <div><strong>Created:</strong> {formatTime(task.created_at)}</div>
                        <div><strong>Updated:</strong> {formatTime(task.updated_at)}</div>
                        {task.approved_by && (
                            <>
                                <div><strong>Approved by:</strong> {task.approved_by}</div>
                                <div><strong>Approved at:</strong> {formatTime(task.approved_at)}</div>
                            </>
                        )}
                    </div>
                    {task.description && (
                        <p className="task-description">{task.description}</p>
                    )}
                </div>

                {/* Dispatch Button */}
                {canDispatch && (
                    <div className="task-detail-section">
                        <button
                            className="dispatch-btn"
                            onClick={handleDispatch}
                            disabled={dispatching}
                        >
                            {dispatching ? '⏳ Dispatching...' : '🚀 Dispatch Task'}
                        </button>
                        {dispatchError && (
                            <div className="dispatch-error">
                                ❌ {dispatchError}
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <p>Loading...</p>
                ) : (
                    <>
                        {/* Child Tasks */}
                        <div className="task-detail-section">
                            <h3>🔗 Child Tasks ({children.length})</h3>
                            {children.length === 0 ? (
                                <p className="empty">No child tasks</p>
                            ) : (
                                <div className="child-list">
                                    {children.map(child => (
                                        <div key={child.id} className="child-item">
                                            <span className="child-title">{child.title}</span>
                                            <span
                                                className="status-badge"
                                                style={{ backgroundColor: getStatusColor(child.status) }}
                                            >
                                                {child.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Run History with Live Panel */}
                        <div className="task-detail-section">
                            <h3>🏃 Run History</h3>
                            <RunLogPanel taskId={task.id} pollIntervalMs={5000} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
