// ============================================================================
// API Barrel — Re-exports everything for backwards-compatible imports
// ============================================================================

// Base utilities
export { API_BASE, fetchWithAuth } from './base';

// All types
export type {
    Customer,
    Activity,
    Task,
    TaskRun,
    DispatchResult,
    TaskProgressStep,
    TaskProgress,
    Skill,
    SkillMatch,
    GitFileStatus,
    GitCommitInfo,
    ToolInfo,
    StreamEvent,
    ErrorPattern,
    RecoveryRule,
    QueueTask,
    MemorySearchResult,
    TimelineEntry,
    RetentionPolicy,
} from './types';

// Customer domain
export { fetchCustomers, fetchActivities, fetchCustomerContext } from './customers';

// Task domain
export {
    fetchTasks,
    fetchTask,
    approveTask,
    dispatchTask,
    fetchTaskChildren,
    fetchTaskRuns,
    fetchRunsGlobal,
    getReportUrl,
    fetchTaskProgress,
} from './tasks';

// Chat domain
export { sendAlexMessage } from './chat';

// Skills domain
export {
    fetchSkills,
    fetchSkillDetail,
    enableSkill,
    disableSkill,
    dryRunSkill,
    checkSkills,
    validateSkill,
} from './skills';

// System domain
export {
    fetchStatus,
    fetchGitStatus,
    fetchGitDiff,
    gitAdd,
    gitCommit,
    gitPush,
    fetchGitLog,
    fetchAgentQueue,
    updateQueueTask,
    fetchAgentContext,
    fetchTools,
    invokeTool,
    connectEventStream,
    fetchRecentEvents,
    fetchErrorPatterns,
    analyzeError,
    retryFailedRun,
    fetchRecoveryRules,
    createRecoveryRule,
    searchMemory,
    fetchMemoryTimeline,
    fetchMemoryStats,
    fetchStorageOverview,
    archiveRecords,
    fetchRetentionPolicy,
    updateRetentionPolicy,
    runMemoryCleanup,
} from './system';
