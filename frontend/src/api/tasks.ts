// ============================================================================
// Tasks API — CRUD, dispatch, progress, runs
// ============================================================================
import { API_BASE, fetchWithAuth } from './base';
import type { Task, TaskRun, DispatchResult, TaskProgress } from './types';

export async function fetchTasks(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    customer_id?: string;
}): Promise<Task[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.customer_id) searchParams.set('customer_id', params.customer_id);

    const url = `${API_BASE}/tasks?${searchParams}`;
    const res = await fetchWithAuth(url);
    const data = await res.json();
    return data.tasks || [];
}

export async function fetchTask(taskId: string): Promise<Task | null> {
    const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.task || null;
}

export async function approveTask(taskId: string, approvedBy: string): Promise<Task> {
    const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: approvedBy })
    });
    const data = await res.json();
    return data.task;
}

export async function dispatchTask(taskId: string, workerId?: string): Promise<DispatchResult> {
    const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerId || 'backend-dispatcher-v0' })
    });
    const data = await res.json();

    if (!res.ok) {
        return {
            success: false,
            error: data.error || `Dispatch failed with status ${res.status}`,
            task: data.task,
            run: data.run
        };
    }

    return {
        success: true,
        message: data.message,
        task: data.task,
        run: data.run
    };
}

export async function fetchTaskChildren(taskId: string): Promise<Task[]> {
    const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}/children`);
    const data = await res.json();
    return data.children || [];
}

export async function fetchTaskRuns(taskId: string): Promise<TaskRun[]> {
    const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}/runs`);
    const data = await res.json();
    return data.runs || [];
}

export async function fetchRunsGlobal(params?: {
    limit?: number;
    status?: string;
    executorPrefix?: string;
}): Promise<TaskRun[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.executorPrefix) searchParams.set('executorPrefix', params.executorPrefix);

    const url = `${API_BASE}/runs?${searchParams}`;
    const res = await fetchWithAuth(url);
    const data = await res.json();
    return data.runs || [];
}

export function getReportUrl(taskId: string): string {
    return `${API_BASE}/reports/${taskId}`;
}

export async function fetchTaskProgress(taskId: string): Promise<{
    progress: TaskProgress | null;
    run_status: string | null;
}> {
    try {
        const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}/progress`);
        if (!res.ok) return { progress: null, run_status: null };
        const data = await res.json();
        return {
            progress: data.progress || null,
            run_status: data.run_status || null
        };
    } catch {
        return { progress: null, run_status: null };
    }
}
