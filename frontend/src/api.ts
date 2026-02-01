// API wrapper for Skyland Command Center
const API_BASE = 'http://localhost:3001/api/v1';

// ============================================================================
// Types
// ============================================================================

export interface Customer {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'warning' | 'error';
    errors_24h: number;
    warnings_24h: number;
    open_tasks: number;
    failed_tasks_24h: number;
    last_activity: string | null;
}

export interface Activity {
    id: string;
    customer_id: string | null;
    agent: string;
    action: string;
    event_type: string;
    severity: 'info' | 'warn' | 'error';
    autonomy_level: 'OBSERVE' | 'SUGGEST' | 'ACT' | 'SILENT';
    details: Record<string, unknown>;
    created_at: string;
}

export interface Task {
    id: string;
    customer_id: string | null;
    title: string;
    description: string | null;
    assigned_agent: string | null;
    status: 'created' | 'assigned' | 'in_progress' | 'review' | 'completed' | 'failed';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    approved_by: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ChatResponse {
    response: string;
    conversation_id: string;
    intent: 'STATUS_CHECK' | 'SUMMARY' | 'CREATE_TASK' | 'HELP';
    data: Record<string, unknown>;
    actions_taken: Array<{ action: string; table: string; details?: Record<string, unknown> }>;
    proposed_actions: Array<{ type: string; task_id?: string; task?: Task }>;
    suggestions: string[];
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchCustomers(slug?: string): Promise<Customer[]> {
    const url = slug
        ? `${API_BASE}/customers?slug=${encodeURIComponent(slug)}`
        : `${API_BASE}/customers`;
    const res = await fetch(url);
    const data = await res.json();
    return data.customers || [];
}

export async function fetchActivities(params?: {
    limit?: number;
    offset?: number;
    customer_id?: string;
}): Promise<Activity[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.customer_id) searchParams.set('customer_id', params.customer_id);

    const url = `${API_BASE}/activities?${searchParams}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.activities || [];
}

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
    const res = await fetch(url);
    const data = await res.json();
    return data.tasks || [];
}

export async function approveTask(taskId: string, approvedBy: string): Promise<Task> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: approvedBy })
    });
    const data = await res.json();
    return data.task;
}

export async function sendChatMessage(message: string, conversationId?: string): Promise<ChatResponse> {
    const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            channel: 'chat',
            conversation_id: conversationId
        })
    });
    return res.json();
}

export async function fetchStatus(): Promise<{
    time: string;
    supabase: { ok: boolean };
    counts: { customers: number; tasks_open: number; suggest_pending: number };
}> {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
}
