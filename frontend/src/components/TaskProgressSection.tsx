import { useEffect, useState, useRef } from 'react';
import type { TaskProgress } from '../api';
import { fetchTaskProgress } from '../api';

interface Props {
    taskId: string;
    taskStatus: string;
    executor: string;
}

export function TaskProgressSection({ taskId, taskStatus, executor }: Props) {
    const [progress, setProgress] = useState<TaskProgress | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Only show for claw: executors
    const shouldShow = executor.startsWith('claw:');

    useEffect(() => {
        if (!shouldShow) return;

        const loadProgress = async () => {
            const { progress: p } = await fetchTaskProgress(taskId);
            setProgress(p);
        };

        // Initial load
        loadProgress();

        // Poll only when task is in_progress
        if (taskStatus === 'in_progress') {
            pollingRef.current = setInterval(loadProgress, 2000);
        }

        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, [taskId, taskStatus, shouldShow]);

    // Don't render if not applicable
    if (!shouldShow) return null;

    // Don't render if no progress data and task isn't running
    if (!progress && taskStatus !== 'in_progress') return null;

    // Loading state for running tasks without progress yet
    if (!progress && taskStatus === 'in_progress') {
        return (
            <div className="task-detail-section progress-section">
                <h3>⏳ Progress</h3>
                <div className="progress-loading">
                    <div className="progress-spinner"></div>
                    <span>Väntar på agenten...</span>
                </div>
            </div>
        );
    }

    if (!progress) return null;

    const percent = progress.percent ?? 0;
    const steps = progress.steps ?? [];

    return (
        <div className="task-detail-section progress-section">
            <div className="progress-header">
                <h3>⏳ Progress</h3>
                <span className="progress-percent">{percent}%</span>
            </div>

            {/* Progress Bar */}
            <div className="progress-bar-container">
                <div
                    className="progress-bar-fill"
                    style={{ width: `${percent}%` }}
                ></div>
            </div>

            {/* Step Checklist */}
            {steps.length > 0 && (
                <div className="progress-steps">
                    {steps.map((step) => (
                        <div key={step.id} className={`progress-step progress-step-${step.status}`}>
                            <span className="step-icon">
                                {step.status === 'completed' && '✅'}
                                {step.status === 'running' && '⏳'}
                                {step.status === 'pending' && '○'}
                                {step.status === 'failed' && '❌'}
                            </span>
                            <span className="step-name">{step.name}</span>
                            {step.status === 'running' && (
                                <span className="step-dots">...</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
