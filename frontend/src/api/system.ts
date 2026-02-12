// ============================================================================
// System API — Status, git, queue, events, errors, memory, tools, context
// ============================================================================
import { API_BASE, fetchWithAuth } from './base';
import { SCC_API_TOKEN } from '../config';
import type {
    Activity, Task,
    StreamEvent, ErrorPattern, RecoveryRule,
    MemorySearchResult, TimelineEntry, RetentionPolicy,
    QueueTask, ToolInfo,
    GitFileStatus, GitCommitInfo,
} from './types';

// ─── Status ───
export async function fetchStatus(): Promise<{
    time: string;
    supabase: { ok: boolean };
    counts: { customers: number; tasks_open: number; suggest_pending: number };
}> {
    const res = await fetchWithAuth(`${API_BASE}/status`);
    return res.json();
}

// ─── Git Operations (Ticket 5.1 / 5.2) ───
export async function fetchGitStatus(): Promise<{
    branch: string;
    clean: boolean;
    files: GitFileStatus[];
    file_count: number;
    last_commit: { hash: string; subject: string; date: string };
}> {
    const res = await fetchWithAuth(`${API_BASE}/git/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchGitDiff(staged?: boolean): Promise<{
    diff: string;
    files: Array<{ file: string; changes: string }>;
    file_count: number;
    staged: boolean;
}> {
    const url = staged ? `${API_BASE}/git/diff?staged=true` : `${API_BASE}/git/diff`;
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function gitAdd(files: string[] = ['.']): Promise<{ success: boolean; staged_files: string[]; status: string }> {
    const res = await fetchWithAuth(`${API_BASE}/git/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function gitCommit(message: string): Promise<{
    success: boolean;
    commit_hash: string;
    message: string;
    result: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function gitPush(): Promise<{ success?: boolean; error?: string; message?: string; branch?: string }> {
    const res = await fetchWithAuth(`${API_BASE}/git/push`, { method: 'POST' });
    return res.json();
}

export async function fetchGitLog(count = 10): Promise<{ branch: string; commits: GitCommitInfo[]; count: number }> {
    const res = await fetchWithAuth(`${API_BASE}/git/log?count=${count}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Agent Task Queue (Ticket 6.1) ───
export async function fetchAgentQueue(params?: {
    agent_id?: string;
    status?: string;
    priority?: string;
    limit?: number;
}): Promise<{ queue: QueueTask[]; count: number }> {
    const searchParams = new URLSearchParams();
    if (params?.agent_id) searchParams.set('agent_id', params.agent_id);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.priority) searchParams.set('priority', params.priority);
    if (params?.limit) searchParams.set('limit', String(params.limit));

    const url = `${API_BASE}/agent-queue?${searchParams}`;
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function updateQueueTask(taskId: string, updates: {
    priority?: string;
    status?: string;
    assigned_agent?: string;
}): Promise<{ task: Task }> {
    const res = await fetchWithAuth(`${API_BASE}/agent-queue/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Agent Context (Ticket 3.1) ───
export async function fetchAgentContext(agentId: string): Promise<{
    agent_id: string;
    context: {
        activities: Activity[];
        tasks: Task[];
        skills: { active: Array<{ name: string; description: string; has_scripts: boolean; tags: string[] }>; total: number; active_count: number };
        system_status: { total_tasks: number; pending_approvals: number; errors_24h: number; timestamp: string };
    };
}> {
    const res = await fetchWithAuth(`${API_BASE}/context/${encodeURIComponent(agentId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Tools (Ticket 4.1) ───
export async function fetchTools(): Promise<{
    tools: ToolInfo[];
    count: number;
    categories: string[];
}> {
    const res = await fetchWithAuth(`${API_BASE}/tools`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function invokeTool(tool: string, params?: Record<string, unknown>, agentId?: string): Promise<{
    tool: string;
    status: string;
    result: unknown;
    duration_ms: number;
    agent_id: string;
    timestamp: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/tools/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, params, agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Event Stream (Ticket 7.1) ───
export function connectEventStream(
    onEvent: (event: StreamEvent) => void,
    filters?: { types?: string; agentId?: string; customerId?: string }
): EventSource {
    const params = new URLSearchParams();
    if (filters?.types) params.set('types', filters.types);
    if (filters?.agentId) params.set('agentId', filters.agentId);
    if (filters?.customerId) params.set('customerId', filters.customerId);

    if (SCC_API_TOKEN) params.set('token', SCC_API_TOKEN);
    const qs = params.toString();
    const url = `${API_BASE}/events/stream${qs ? `?${qs}` : ''}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
        try {
            const event: StreamEvent = JSON.parse(e.data);
            onEvent(event);
        } catch { /* ignore parse errors */ }
    };

    return es;
}

export async function fetchRecentEvents(limit?: number, types?: string): Promise<{
    events: StreamEvent[];
    count: number;
}> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (types) params.set('types', types);

    const qs = params.toString();
    const res = await fetchWithAuth(`${API_BASE}/events/recent${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Error Recovery (Ticket 8.1) ───
export async function fetchErrorPatterns(): Promise<{
    patterns: ErrorPattern[];
    total_errors: number;
    period: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/recovery/errors`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function analyzeError(activityId: string): Promise<{
    activity_id: string;
    agent: string;
    action: string;
    classification: ErrorPattern['classification'];
    details: Record<string, unknown>;
    created_at: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/recovery/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_id: activityId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function retryFailedRun(taskId: string): Promise<{
    status: string;
    task: Task;
}> {
    const res = await fetchWithAuth(`${API_BASE}/recovery/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchRecoveryRules(): Promise<{
    rules: RecoveryRule[];
    count: number;
}> {
    const res = await fetchWithAuth(`${API_BASE}/recovery/rules`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function createRecoveryRule(rule: {
    pattern: { agent?: string; action?: string; error_contains?: string };
    recovery_action: 'retry' | 'notify' | 'disable_skill' | 'escalate';
    max_retries?: number;
    cooldown_minutes?: number;
}): Promise<{ rule: RecoveryRule }> {
    const res = await fetchWithAuth(`${API_BASE}/recovery/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Memory Search (Ticket 9.1) ───
export async function searchMemory(
    query: string,
    scope?: 'all' | 'activities' | 'messages' | 'tasks',
    limit?: number
): Promise<{
    results: MemorySearchResult[];
    count: number;
    total_matches: number;
    query: string;
    scope: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, scope, limit }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchMemoryTimeline(params?: {
    agentId?: string;
    customerId?: string;
    limit?: number;
    since?: string;
    until?: string;
}): Promise<{
    timeline: TimelineEntry[];
    count: number;
}> {
    const qp = new URLSearchParams();
    if (params?.agentId) qp.set('agentId', params.agentId);
    if (params?.customerId) qp.set('customerId', params.customerId);
    if (params?.limit) qp.set('limit', String(params.limit));
    if (params?.since) qp.set('since', params.since);
    if (params?.until) qp.set('until', params.until);

    const qs = qp.toString();
    const res = await fetchWithAuth(`${API_BASE}/memory/timeline${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchMemoryStats(): Promise<{
    tables: Record<string, { count: number; oldest?: string; newest?: string }>;
    top_agents: Array<{ agent: string; count: number }>;
    top_event_types: Array<{ event_type: string; count: number }>;
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── Memory Management (Ticket 10.1) ───
export async function fetchStorageOverview(): Promise<{
    storage: Record<string, {
        row_count: number;
        oldest_record?: string;
        newest_record?: string;
    }>;
    total_rows: number;
    generated_at: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/storage`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function archiveRecords(
    table: 'activities' | 'messages' | 'task_runs',
    beforeDate: string,
    dryRun?: boolean
): Promise<{
    dry_run: boolean;
    table: string;
    before_date: string;
    records_to_delete?: number;
    deleted_count?: number;
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, before_date: beforeDate, dry_run: dryRun }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchRetentionPolicy(): Promise<{
    policy: RetentionPolicy;
    source: 'configured' | 'default';
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/retention`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function updateRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<{
    policy: RetentionPolicy;
    status: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/retention`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function runMemoryCleanup(): Promise<{
    status: string;
    policy: RetentionPolicy;
    results: Record<string, number>;
    total_deleted: number;
}> {
    const res = await fetchWithAuth(`${API_BASE}/memory/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
