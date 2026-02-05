import { useState, useEffect, useRef, useCallback } from 'react';
import type { TaskRun, Task } from '../api';
import { fetchTaskRuns, fetchRunsGlobal, fetchTask } from '../api';
import { TaskDetail } from './TaskDetail';

interface Props {
    taskId?: string;        // If provided, show per-task runs; otherwise global
    limit?: number;         // Default 20
    pollIntervalMs?: number; // Default 5000
}

type ExecutorFilter = 'all' | 'n8n' | 'local' | 'claw';

export function RunLogPanel({ taskId, limit = 20, pollIntervalMs = 5000 }: Props) {
    const [runs, setRuns] = useState<TaskRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [executorFilter, setExecutorFilter] = useState<ExecutorFilter>('all');
    const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const isFirstLoad = useRef(true);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [loadError, setLoadError] = useState<{ runId: string; error: string } | null>(null);

    const loadRuns = useCallback(async () => {
        try {
            let data: TaskRun[];
            if (taskId) {
                data = await fetchTaskRuns(taskId);
            } else {
                const executorPrefix = executorFilter === 'all' ? undefined : executorFilter;
                data = await fetchRunsGlobal({ limit, executorPrefix });
            }
            setRuns(data);

            // Auto-scroll to top (newest) on first load or when new runs appear
            if (containerRef.current && (isFirstLoad.current || data.length > runs.length)) {
                containerRef.current.scrollTop = 0;
            }
            isFirstLoad.current = false;
        } catch (err) {
            console.error('Error loading runs:', err);
        } finally {
            setLoading(false);
        }
    }, [taskId, limit, executorFilter, runs.length]);

    // Initial load and polling
    useEffect(() => {
        setLoading(true);
        isFirstLoad.current = true;
        loadRuns();

        const interval = setInterval(loadRuns, pollIntervalMs);
        return () => clearInterval(interval);
    }, [loadRuns, pollIntervalMs]);

    const toggleExpand = (runId: string) => {
        setExpandedRuns(prev => {
            const next = new Set(prev);
            if (next.has(runId)) {
                next.delete(runId);
            } else {
                next.add(runId);
            }
            return next;
        });
    };

    const getStatusClass = (status: string) => `status-badge status-${status}`;

    const formatTime = (iso: string | null) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('sv-SE');
    };

    const hasContent = (obj: Record<string, unknown> | null | undefined) => {
        return obj && Object.keys(obj).length > 0;
    };

    const handleOpenTask = async (runId: string, runTaskId: string) => {
        setLoadError(null);
        const task = await fetchTask(runTaskId);
        if (!task) {
            setLoadError({ runId, error: 'Task not found' });
            return;
        }
        setSelectedTask(task);
    };

    // Filter runs by executor (client-side for per-task mode)
    const filteredRuns = taskId && executorFilter !== 'all'
        ? runs.filter(r => r.executor.startsWith(executorFilter))
        : runs;

    return (
        <div className="run-log-panel">
            {/* Executor Filter Tabs */}
            <div className="executor-tabs">
                {(['all', 'n8n', 'local', 'claw'] as ExecutorFilter[]).map(tab => (
                    <button
                        key={tab}
                        className={`executor-tab ${executorFilter === tab ? 'active' : ''}`}
                        onClick={() => setExecutorFilter(tab)}
                    >
                        {tab === 'all' ? 'All' : tab}
                    </button>
                ))}
            </div>

            {/* Runs List */}
            <div className="run-list-container" ref={containerRef}>
                {loading && runs.length === 0 ? (
                    <p className="loading">Loading runs...</p>
                ) : filteredRuns.length === 0 ? (
                    <p className="empty">No runs found</p>
                ) : (
                    <div className="run-list">
                        {filteredRuns.map(run => (
                            <div key={run.id} className="run-item-expandable">
                                <div
                                    className="run-header-row"
                                    onClick={() => toggleExpand(run.id)}
                                >
                                    <span className="expand-icon">
                                        {expandedRuns.has(run.id) ? '▼' : '▶'}
                                    </span>
                                    <span className="run-number">#{run.run_number}</span>
                                    <span className={getStatusClass(run.status)}>
                                        {run.status}
                                    </span>
                                    <code className="executor-tag">{run.executor}</code>
                                    <span className="run-time">{formatTime(run.queued_at)}</span>
                                </div>

                                {expandedRuns.has(run.id) && (
                                    <div className="run-details">
                                        <div className="run-meta-grid">
                                            <div><strong>Run ID:</strong> <code>{run.id.slice(0, 8)}...</code></div>
                                            {!taskId && (
                                                <div>
                                                    <strong>Task ID:</strong> <code>{run.task_id.slice(0, 8)}...</code>
                                                    <button
                                                        className="open-task-btn"
                                                        onClick={(e) => { e.stopPropagation(); handleOpenTask(run.id, run.task_id); }}
                                                    >
                                                        🔗 Open task
                                                    </button>
                                                    {loadError?.runId === run.id && (
                                                        <span className="load-error">❌ {loadError.error}</span>
                                                    )}
                                                </div>
                                            )}
                                            <div><strong>Started:</strong> {formatTime(run.started_at)}</div>
                                            <div><strong>Ended:</strong> {formatTime(run.ended_at)}</div>
                                            {run.worker_id && <div><strong>Worker:</strong> <code>{run.worker_id}</code></div>}
                                        </div>

                                        {hasContent(run.output) && (
                                            <div className="json-section">
                                                <strong>Output:</strong>
                                                <pre className="json-viewer">{JSON.stringify(run.output, null, 2)}</pre>
                                            </div>
                                        )}

                                        {hasContent(run.error) && (
                                            <div className="json-section error">
                                                <strong>Error:</strong>
                                                <pre className="json-viewer error">{JSON.stringify(run.error, null, 2)}</pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Task Detail Modal */}
            {selectedTask && (
                <TaskDetail
                    task={selectedTask}
                    onClose={() => setSelectedTask(null)}
                    onTaskUpdated={(updatedTask) => setSelectedTask(updatedTask)}
                />
            )}
        </div>
    );
}
