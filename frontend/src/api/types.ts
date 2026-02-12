// ============================================================================
// Shared Types — All interfaces used across API modules
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
    child_count?: number;
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

export interface DispatchResult {
    success: boolean;
    message?: string;
    task?: Task;
    run?: TaskRun;
    error?: string;
}

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

export interface SkillMatch {
    skill_name: string;
    description: string;
    relevance_score: number;
    enabled: boolean;
    has_scripts: boolean;
    tags: string[];
}

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

export interface ToolInfo {
    name: string;
    description: string;
    category: string;
    parameters: Array<{ name: string; required: boolean; description: string }>;
}

export interface StreamEvent {
    id: string;
    type: string;
    data: Record<string, unknown>;
    source?: string;
    timestamp: string;
}

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

export interface MemorySearchResult {
    source_type: 'activity' | 'message' | 'task';
    source_id: string;
    snippet: string;
    relevance_score: number;
    created_at: string;
    metadata: Record<string, unknown>;
}

export interface TimelineEntry {
    type: 'activity' | 'message';
    id: string;
    summary: string;
    created_at: string;
    metadata: Record<string, unknown>;
}

export interface RetentionPolicy {
    activities_days: number;
    messages_days: number;
    task_runs_days: number;
}
