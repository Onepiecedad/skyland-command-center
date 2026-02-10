// API wrapper for Skyland Command Center
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api/v1';

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
    parent_task_id: string | null;
    title: string;
    description: string | null;
    assigned_agent: string | null;
    executor: string;
    status: 'created' | 'assigned' | 'in_progress' | 'review' | 'completed' | 'failed';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    approved_by: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
    child_count?: number; // Optional, for list views
}

export interface TaskRun {
    id: string;
    task_id: string;
    run_number: number;
    executor: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
    queued_at: string;
    started_at: string | null;
    ended_at: string | null;
    worker_id: string | null;
    input_snapshot: Record<string, unknown> | null;
    output: Record<string, unknown>;
    error: Record<string, unknown>;
    metrics: Record<string, unknown>;
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
    event_type?: string;
    severity?: string;
    agent?: string;
}): Promise<Activity[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.customer_id) searchParams.set('customer_id', params.customer_id);
    if (params?.event_type) searchParams.set('event_type', params.event_type);
    if (params?.severity) searchParams.set('severity', params.severity);
    if (params?.agent) searchParams.set('agent', params.agent);

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

export async function sendAlexMessage(message: string, conversationId?: string): Promise<{
    response: string;
    conversation_id?: string;
}> {
    const GATEWAY = 'http://localhost:18789';
    const res = await fetch(`${GATEWAY}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversation_id: conversationId }),
    });
    if (!res.ok) throw new Error(`Alex gateway error: ${res.status}`);
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

export async function fetchTaskChildren(taskId: string): Promise<Task[]> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/children`);
    const data = await res.json();
    return data.children || [];
}

export async function fetchTaskRuns(taskId: string): Promise<TaskRun[]> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/runs`);
    const data = await res.json();
    return data.runs || [];
}

export interface DispatchResult {
    success: boolean;
    message?: string;
    task?: Task;
    run?: TaskRun;
    error?: string;
}

export async function dispatchTask(taskId: string, workerId?: string): Promise<DispatchResult> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/dispatch`, {
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

export async function fetchTask(taskId: string): Promise<Task | null> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.task || null;
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
    const res = await fetch(url);
    const data = await res.json();
    return data.runs || [];
}

export function getReportUrl(taskId: string): string {
    return `${API_BASE}/reports/${taskId}`;
}

// ============================================================================
// Task Progress Types & API
// ============================================================================

export interface TaskProgressStep {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface TaskProgress {
    percent: number;
    current_step?: string;
    steps?: TaskProgressStep[];
}

export async function fetchTaskProgress(taskId: string): Promise<{
    progress: TaskProgress | null;
    run_status: string | null;
}> {
    try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}/progress`);
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

// ============================================================================
// Skill Registry Types & API (Ticket 11.1 / 11.3)
// ============================================================================

export interface Skill {
    skill_name: string;
    description: string;
    path: string;
    status: 'active' | 'deprecated' | 'draft';
    homepage?: string;
    emoji?: string;
    has_scripts: boolean;
    file_count: number;
    enabled: boolean;
    tags: string[];
    readme?: string;
    metadata?: Record<string, unknown>;
    files?: Array<{ name: string; size: number; modified: string; is_directory: boolean }>;
}

export async function fetchSkills(): Promise<{ skills: Skill[]; count: number; enabled_count?: number; disabled_count?: number }> {
    const res = await fetch(`${API_BASE}/skills`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchSkillDetail(name: string): Promise<{ skill: Skill }> {
    const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Skill Lifecycle API (Ticket 11.2)
// ============================================================================

export async function enableSkill(name: string): Promise<{ status: string; skill: string; enabled: boolean }> {
    const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}/enable`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function disableSkill(name: string): Promise<{ status: string; skill: string; enabled: boolean }> {
    const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}/disable`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function dryRunSkill(name: string): Promise<{
    skill: string;
    valid: boolean;
    checks: Array<{ check: string; passed: boolean; detail?: string }>;
}> {
    const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}/dry-run`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Skill Checker API (Ticket 11.4)
// ============================================================================

export interface SkillMatch {
    skill_name: string;
    description: string;
    relevance_score: number;
    enabled: boolean;
    has_scripts: boolean;
    tags: string[];
}

export async function checkSkills(task: string, agentId?: string): Promise<{
    task: string;
    matches: SkillMatch[];
    match_count: number;
}> {
    const res = await fetch(`${API_BASE}/skills/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function validateSkill(name: string): Promise<{
    skill_name: string;
    usable: boolean;
    checks: Array<{ check: string; passed: boolean; detail?: string }>;
}> {
    const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}/validate`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Git Operations API (Ticket 5.1 / 5.2)
// ============================================================================

export interface GitFileStatus {
    status: string;
    file: string;
}

export interface GitCommitInfo {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
}

export async function fetchGitStatus(): Promise<{
    branch: string;
    clean: boolean;
    files: GitFileStatus[];
    file_count: number;
    last_commit: { hash: string; subject: string; date: string };
}> {
    const res = await fetch(`${API_BASE}/git/status`);
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
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function gitAdd(files: string[] = ['.']): Promise<{ success: boolean; staged_files: string[]; status: string }> {
    const res = await fetch(`${API_BASE}/git/add`, {
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
    const res = await fetch(`${API_BASE}/git/commit`, {
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
    const res = await fetch(`${API_BASE}/git/push`, { method: 'POST' });
    return res.json(); // may be 403 for protected branches
}

export async function fetchGitLog(count = 10): Promise<{ branch: string; commits: GitCommitInfo[]; count: number }> {
    const res = await fetch(`${API_BASE}/git/log?count=${count}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Agent Task Queue API (Ticket 6.1)
// ============================================================================

export interface QueueTask {
    task_id: string;
    title: string;
    description: string | null;
    assigned_agent_id: string | null;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    priority_level: number;
    status: string;
    created_at: string;
    updated_at: string;
}

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
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function updateQueueTask(taskId: string, updates: {
    priority?: string;
    status?: string;
    assigned_agent?: string;
}): Promise<{ task: Task }> {
    const res = await fetch(`${API_BASE}/agent-queue/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Kontextuell Data API (Ticket 3.1)
// ============================================================================

export async function fetchAgentContext(agentId: string): Promise<{
    agent_id: string;
    context: {
        activities: Activity[];
        tasks: Task[];
        skills: { active: Array<{ name: string; description: string; has_scripts: boolean; tags: string[] }>; total: number; active_count: number };
        system_status: { total_tasks: number; pending_approvals: number; errors_24h: number; timestamp: string };
    };
}> {
    const res = await fetch(`${API_BASE}/context/${encodeURIComponent(agentId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchCustomerContext(slug: string): Promise<{
    customer: Customer & { errors_24h: number; warnings_24h: number; open_tasks: number; failed_tasks_24h: number; last_activity: string | null };
    context: {
        activities: Activity[];
        tasks: Task[];
        related_agents: string[];
    };
}> {
    const res = await fetch(`${API_BASE}/context/customer/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Verktygsanrop API (Ticket 4.1)
// ============================================================================

export interface ToolInfo {
    name: string;
    description: string;
    category: string;
    parameters: Array<{ name: string; required: boolean; description: string }>;
}

export async function fetchTools(): Promise<{
    tools: ToolInfo[];
    count: number;
    categories: string[];
}> {
    const res = await fetch(`${API_BASE}/tools`);
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
    const res = await fetch(`${API_BASE}/tools/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, params, agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Event Stream API (Ticket 7.1)
// ============================================================================

export interface StreamEvent {
    id: string;
    type: string;
    data: Record<string, unknown>;
    source?: string;
    timestamp: string;
}

export function connectEventStream(
    onEvent: (event: StreamEvent) => void,
    filters?: { types?: string; agentId?: string; customerId?: string }
): EventSource {
    const params = new URLSearchParams();
    if (filters?.types) params.set('types', filters.types);
    if (filters?.agentId) params.set('agentId', filters.agentId);
    if (filters?.customerId) params.set('customerId', filters.customerId);

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
    const res = await fetch(`${API_BASE}/events/recent${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Error Recovery API (Ticket 8.1)
// ============================================================================

export interface ErrorPattern {
    agent: string;
    action: string;
    count: number;
    first_seen: string;
    last_seen: string;
    sample_details: Record<string, unknown>;
    classification: {
        error_class: 'transient' | 'config' | 'dependency' | 'unknown';
        confidence: number;
        suggested_action: string;
        description: string;
    };
}

export async function fetchErrorPatterns(): Promise<{
    patterns: ErrorPattern[];
    total_errors: number;
    period: string;
}> {
    const res = await fetch(`${API_BASE}/recovery/errors`);
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
    const res = await fetch(`${API_BASE}/recovery/analyze`, {
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
    const res = await fetch(`${API_BASE}/recovery/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export interface RecoveryRule {
    id: string;
    pattern: { agent?: string; action?: string; error_contains?: string };
    recovery_action: 'retry' | 'notify' | 'disable_skill' | 'escalate';
    max_retries: number;
    cooldown_minutes: number;
    enabled: boolean;
    created_at: string;
    executions: number;
    last_executed?: string;
}

export async function fetchRecoveryRules(): Promise<{
    rules: RecoveryRule[];
    count: number;
}> {
    const res = await fetch(`${API_BASE}/recovery/rules`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function createRecoveryRule(rule: {
    pattern: { agent?: string; action?: string; error_contains?: string };
    recovery_action: 'retry' | 'notify' | 'disable_skill' | 'escalate';
    max_retries?: number;
    cooldown_minutes?: number;
}): Promise<{ rule: RecoveryRule }> {
    const res = await fetch(`${API_BASE}/recovery/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Memory Search API (Ticket 9.1)
// ============================================================================

export interface MemorySearchResult {
    source_type: 'activity' | 'message' | 'task';
    source_id: string;
    snippet: string;
    relevance_score: number;
    created_at: string;
    metadata: Record<string, unknown>;
}

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
    const res = await fetch(`${API_BASE}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, scope, limit }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export interface TimelineEntry {
    type: 'activity' | 'message';
    id: string;
    summary: string;
    created_at: string;
    metadata: Record<string, unknown>;
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
    const res = await fetch(`${API_BASE}/memory/timeline${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function fetchMemoryStats(): Promise<{
    tables: Record<string, { count: number; oldest?: string; newest?: string }>;
    top_agents: Array<{ agent: string; count: number }>;
    top_event_types: Array<{ event_type: string; count: number }>;
}> {
    const res = await fetch(`${API_BASE}/memory/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============================================================================
// Memory Management API (Ticket 10.1)
// ============================================================================

export async function fetchStorageOverview(): Promise<{
    storage: Record<string, {
        row_count: number;
        oldest_record?: string;
        newest_record?: string;
    }>;
    total_rows: number;
    generated_at: string;
}> {
    const res = await fetch(`${API_BASE}/memory/storage`);
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
    const res = await fetch(`${API_BASE}/memory/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, before_date: beforeDate, dry_run: dryRun }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export interface RetentionPolicy {
    activities_days: number;
    messages_days: number;
    task_runs_days: number;
}

export async function fetchRetentionPolicy(): Promise<{
    policy: RetentionPolicy;
    source: 'configured' | 'default';
}> {
    const res = await fetch(`${API_BASE}/memory/retention`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function updateRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<{
    policy: RetentionPolicy;
    status: string;
}> {
    const res = await fetch(`${API_BASE}/memory/retention`, {
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
    const res = await fetch(`${API_BASE}/memory/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

