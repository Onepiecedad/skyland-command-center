import { supabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';

// ============================================================================
// Rate limit configuration (Ticket 20)
// ============================================================================
const CLAW_MAX_CONCURRENT_PER_CUSTOMER = config.CLAW_MAX_CONCURRENT_PER_CUSTOMER;
const CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER = config.CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER;
const CLAW_MAX_RUNS_PER_HOUR_GLOBAL = config.CLAW_MAX_RUNS_PER_HOUR_GLOBAL;

// Claw executor allowlist (Ticket 19)
const CLAW_EXECUTOR_ALLOWLIST = ['claw:research', 'claw:prospect-finder', 'claw:content', 'claw:deep-research', 'claw:report-writer'];

// ============================================================================
// Types
// ============================================================================
export interface DispatchResult {
    success: boolean;
    task: Record<string, unknown>;
    run: Record<string, unknown>;
    error?: string;
    rateLimited?: boolean;
}

export interface RateLimitResult {
    allowed: boolean;
    reason?: 'concurrent_limit' | 'hourly_limit';
    details?: Record<string, unknown>;
}

// ============================================================================
// Helper: Log activity for task runs
// ============================================================================
export async function logTaskRunActivity(
    customerId: string | null,
    taskId: string,
    runId: string,
    action: 'run_started' | 'run_completed' | 'run_failed' | 'run_timeout',
    severity: 'info' | 'error' | 'warn',
    details: Record<string, unknown> = {}
) {
    try {
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'system:reaper',
            event_type: 'task_run',
            action,
            severity,
            details: { task_id: taskId, run_id: runId, message: `Task run ${action.replace('run_', '')}`, ...details }
        });
    } catch (err) {
        logger.error('task', 'Failed to log activity', { error: err instanceof Error ? err.message : err });
    }
}

// ============================================================================
// Helper: Log rate_limited activity (Ticket 20)
// ============================================================================
export async function logRateLimitedActivity(
    customerId: string | null,
    taskId: string,
    reason: 'concurrent_limit' | 'hourly_limit',
    details: Record<string, unknown> = {}
) {
    try {
        await supabase.from('activities').insert({
            customer_id: customerId,
            agent: 'system:dispatcher',
            event_type: 'rate_limit',
            action: 'rate_limited',
            severity: 'warn',
            details: { task_id: taskId, reason, message: `Task dispatch rate limited: ${reason}`, ...details }
        });
    } catch (err) {
        logger.error('task', 'Failed to log rate_limited activity', { error: err instanceof Error ? err.message : err });
    }
}

// ============================================================================
// Helper: Check claw rate limits before dispatch (Ticket 20)
// ============================================================================
export async function checkClawRateLimits(customerId: string | null, executor: string): Promise<RateLimitResult> {
    // Only apply rate limits to claw executors
    if (!executor.startsWith('claw:')) {
        return { allowed: true };
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    try {
        // Check concurrent running runs for this customer
        if (customerId) {
            const { data: runningTasks, error: runningError } = await supabase
                .from('tasks')
                .select('id, task_runs!inner(id, status)')
                .eq('customer_id', customerId)
                .like('executor', 'claw:%');

            if (!runningError && runningTasks) {
                const runningCount = runningTasks.filter((t: Record<string, unknown>) => {
                    const runs = t.task_runs as Array<Record<string, unknown>>;
                    return runs?.some(r => r.status === 'running');
                }).length;

                if (runningCount >= CLAW_MAX_CONCURRENT_PER_CUSTOMER) {
                    return {
                        allowed: false,
                        reason: 'concurrent_limit',
                        details: {
                            customer_id: customerId,
                            current: runningCount,
                            limit: CLAW_MAX_CONCURRENT_PER_CUSTOMER
                        }
                    };
                }
            }

            // Check hourly limit per customer
            const { count: hourlyCustomerCount, error: hourlyCustomerError } = await supabase
                .from('task_runs')
                .select('id, tasks!inner(customer_id)', { count: 'exact', head: true })
                .like('executor', 'claw:%')
                .gte('queued_at', oneHourAgo)
                .eq('tasks.customer_id', customerId);

            if (!hourlyCustomerError && hourlyCustomerCount !== null && hourlyCustomerCount >= CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER) {
                return {
                    allowed: false,
                    reason: 'hourly_limit',
                    details: {
                        customer_id: customerId,
                        current: hourlyCustomerCount,
                        limit: CLAW_MAX_RUNS_PER_HOUR_PER_CUSTOMER,
                        window: '1 hour'
                    }
                };
            }
        }

        // Check global hourly limit
        const { count: globalCount, error: globalError } = await supabase
            .from('task_runs')
            .select('id', { count: 'exact', head: true })
            .like('executor', 'claw:%')
            .gte('queued_at', oneHourAgo);

        if (!globalError && globalCount !== null && globalCount >= CLAW_MAX_RUNS_PER_HOUR_GLOBAL) {
            return {
                allowed: false,
                reason: 'hourly_limit',
                details: {
                    scope: 'global',
                    current: globalCount,
                    limit: CLAW_MAX_RUNS_PER_HOUR_GLOBAL,
                    window: '1 hour'
                }
            };
        }

        return { allowed: true };
    } catch (err) {
        logger.error('ratelimit', 'Error checking rate limits', { error: err instanceof Error ? err.message : err });
        // On error, allow dispatch (fail open)
        return { allowed: true };
    }
}

// ============================================================================
// Reaper: Timeout stuck running task_runs
// ============================================================================
export async function reapStuckRuns() {
    const timeoutMinutes = config.TASK_RUN_TIMEOUT_MINUTES;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

    try {
        // Find stuck runs: status='running' AND started_at < cutoff
        const { data: stuckRuns, error } = await supabase
            .from('task_runs')
            .select('id, task_id, started_at, tasks(customer_id, status)')
            .eq('status', 'running')
            .lt('started_at', cutoff);

        if (error) {
            logger.error('reaper', 'Error querying stuck runs', { error: error.message });
            return;
        }

        if (!stuckRuns?.length) return;

        logger.info('reaper', `Found ${stuckRuns.length} stuck run(s) to timeout`);

        for (const run of stuckRuns) {
            const now = new Date().toISOString();
            const durationMs = Date.now() - new Date(run.started_at).getTime();
            // Supabase returns tasks as array for foreign key relation
            const taskInfo = Array.isArray(run.tasks) ? run.tasks[0] : run.tasks as { customer_id: string | null; status: string } | null;

            // Update run → timeout
            const { error: runError } = await supabase
                .from('task_runs')
                .update({
                    status: 'timeout',
                    ended_at: now,
                    error: { code: 'timeout', message: `Run timed out after ${timeoutMinutes} minutes` },
                    metrics: { duration_ms: durationMs }
                })
                .eq('id', run.id);

            if (runError) {
                logger.error('reaper', `Failed to update run ${run.id}`, { error: runError.message });
                continue;
            }

            // Update task → failed (if still in_progress)
            if (taskInfo?.status === 'in_progress') {
                await supabase
                    .from('tasks')
                    .update({ status: 'failed' })
                    .eq('id', run.task_id);
            }

            // Log activity
            await logTaskRunActivity(
                taskInfo?.customer_id || null,
                run.task_id,
                run.id,
                'run_timeout',
                'warn',
                { timeout_minutes: timeoutMinutes, duration_ms: durationMs }
            );

            logger.info('reaper', `Run ${run.id} marked as timeout (was running for ${Math.round(durationMs / 1000 / 60)}m)`);
        }
    } catch (err) {
        logger.error('reaper', 'Unexpected error', { error: err instanceof Error ? err.message : err });
    }
}

// ============================================================================
// Executor helpers
// ============================================================================

// Execute local:echo - returns input as output
export async function executeLocalEcho(task: Record<string, unknown>): Promise<{ output: Record<string, unknown>; error?: string }> {
    return {
        output: {
            echo: true,
            input_received: task.input,
            executor: task.executor,
            message: 'Local echo completed successfully'
        }
    };
}

// Execute n8n webhook
export async function executeN8nWebhook(task: Record<string, unknown>, runId: string): Promise<{ triggered: boolean; error?: string }> {
    const webhookUrl = config.N8N_WEBHOOK_URL;

    if (!webhookUrl) {
        return { triggered: false, error: 'N8N_WEBHOOK_URL not configured' };
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                task_id: task.id,
                run_id: runId,
                executor: task.executor,
                title: task.title,
                input: task.input,
                customer_id: task.customer_id,
                callback_url: `${config.BACKEND_URL || 'http://localhost:3001'}/api/v1/n8n/task-result`
            })
        });

        if (!response.ok) {
            return { triggered: false, error: `Webhook returned ${response.status}` };
        }

        return { triggered: true };
    } catch (err) {
        return { triggered: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

// Execute claw webhook (Ticket 19 - async like n8n)
export async function executeClawWebhook(
    task: Record<string, unknown>,
    runId: string
): Promise<{ triggered: boolean; error?: string }> {
    const hookUrl = config.OPENCLAW_HOOK_URL;
    const hookToken = config.OPENCLAW_HOOK_TOKEN;
    const publicBaseUrl = config.SCC_PUBLIC_BASE_URL || config.BACKEND_URL || 'http://localhost:3001';

    if (!hookUrl) {
        return { triggered: false, error: 'OPENCLAW_HOOK_URL not configured' };
    }

    // Extract agent_id from executor (claw:research → research)
    const agentId = (task.executor as string).replace('claw:', '');

    try {
        const response = await fetch(hookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(hookToken ? { 'Authorization': `Bearer ${hookToken}` } : {})
            },
            body: JSON.stringify({
                task_id: task.id,
                run_id: runId,
                agent_id: agentId,
                prompt: task.title,
                input: task.input,
                customer_id: task.customer_id,
                callback_url: `${publicBaseUrl}/api/v1/claw/task-result`
            })
        });

        if (!response.ok) {
            return { triggered: false, error: `OpenClaw hook returned ${response.status}` };
        }

        logger.info('claw', `Triggered ${agentId} for task ${task.id}, run ${runId}`);
        return { triggered: true };
    } catch (err) {
        return { triggered: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

// ============================================================================
// Core dispatcher function
// ============================================================================
export async function dispatchTask(taskId: string, workerId: string): Promise<DispatchResult> {
    // 1. Get task and validate status
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

    if (fetchError || !task) {
        return { success: false, task: {}, run: {}, error: 'Task not found' };
    }

    // Only dispatch from assigned or created status
    if (!['assigned', 'created'].includes(task.status)) {
        return {
            success: false,
            task,
            run: {},
            error: `Cannot dispatch task with status '${task.status}'. Expected 'assigned' or 'created'.`
        };
    }

    // 2. Check rate limits for claw executors (Ticket 20)
    const rateLimitResult = await checkClawRateLimits(task.customer_id, task.executor);
    if (!rateLimitResult.allowed) {
        // Log rate limited activity
        await logRateLimitedActivity(
            task.customer_id,
            taskId,
            rateLimitResult.reason as 'concurrent_limit' | 'hourly_limit',
            rateLimitResult.details
        );

        // Update task with rate limit info (keep in assigned status)
        await supabase
            .from('tasks')
            .update({
                rate_limited_at: new Date().toISOString(),
                rate_limit_reason: rateLimitResult.reason
            })
            .eq('id', taskId);

        logger.info('ratelimit', `Task ${taskId} rate limited: ${rateLimitResult.reason}`);

        return {
            success: false,
            task: { ...task, rate_limited_at: new Date().toISOString(), rate_limit_reason: rateLimitResult.reason },
            run: {},
            error: `Rate limited: ${rateLimitResult.reason}`,
            rateLimited: true
        } as DispatchResult;
    }

    // 3. Get next run number
    const { data: lastRun } = await supabase
        .from('task_runs')
        .select('run_number')
        .eq('task_id', taskId)
        .order('run_number', { ascending: false })
        .limit(1)
        .single();

    const runNumber = (lastRun?.run_number || 0) + 1;

    // 3. Create task_run with status 'running'
    const { data: run, error: runError } = await supabase
        .from('task_runs')
        .insert({
            task_id: taskId,
            run_number: runNumber,
            executor: task.executor,
            status: 'running',
            worker_id: workerId,
            input_snapshot: task.input,
            queued_at: new Date().toISOString(),
            started_at: new Date().toISOString()
        })
        .select()
        .single();

    if (runError || !run) {
        return { success: false, task, run: {}, error: `Failed to create run: ${runError?.message}` };
    }

    // 4. Atomic transition: task status → in_progress
    const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'in_progress' })
        .eq('id', taskId)
        .select()
        .single();

    if (updateError) {
        return { success: false, task, run, error: `Failed to update task: ${updateError.message}` };
    }

    // 5. Log run_started
    await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_started', 'info', {
        executor: task.executor,
        worker_id: workerId,
        run_number: runNumber
    });

    // 6. Execute based on executor type
    const executor = task.executor || 'local:echo';

    if (executor.startsWith('local:echo')) {
        // Synchronous execution
        const result = await executeLocalEcho(task);

        // Update run with result
        await supabase
            .from('task_runs')
            .update({
                status: 'completed',
                output: result.output,
                ended_at: new Date().toISOString()
            })
            .eq('id', run.id);

        // Update task status
        const { data: finalTask } = await supabase
            .from('tasks')
            .update({ status: 'completed', output: result.output })
            .eq('id', taskId)
            .select()
            .single();

        // Log completion
        await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_completed', 'info', {
            executor,
            duration_ms: Date.now() - new Date(run.started_at).getTime()
        });

        return { success: true, task: finalTask || updatedTask, run: { ...run, status: 'completed', output: result.output } };

    } else if (executor.startsWith('n8n:')) {
        // Async execution via webhook
        const result = await executeN8nWebhook(task, run.id);

        if (!result.triggered) {
            // Failed to trigger - mark as failed
            await supabase
                .from('task_runs')
                .update({
                    status: 'failed',
                    error: result.error,
                    ended_at: new Date().toISOString()
                })
                .eq('id', run.id);

            await supabase
                .from('tasks')
                .update({ status: 'failed' })
                .eq('id', taskId);

            await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
                executor,
                error: result.error
            });

            return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: result.error }, error: result.error };
        }

        // Webhook triggered successfully - task stays in_progress until callback
        return { success: true, task: updatedTask, run: { ...run, status: 'running' } };

    } else if (executor.startsWith('claw:')) {
        // Ticket 19: Claw executor with allowlist check
        if (!CLAW_EXECUTOR_ALLOWLIST.includes(executor)) {
            // Not in allowlist - fail immediately
            const errorMsg = `Claw executor not allowed: ${executor}. Allowed: ${CLAW_EXECUTOR_ALLOWLIST.join(', ')}`;

            await supabase
                .from('task_runs')
                .update({
                    status: 'failed',
                    error: { code: 'claw_executor_not_allowed', message: errorMsg },
                    ended_at: new Date().toISOString()
                })
                .eq('id', run.id);

            await supabase
                .from('tasks')
                .update({ status: 'failed' })
                .eq('id', taskId);

            await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
                executor,
                error: errorMsg,
                error_code: 'claw_executor_not_allowed'
            });

            return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: errorMsg }, error: errorMsg };
        }

        // Allowed executor - async webhook execution (like n8n)
        const result = await executeClawWebhook(task, run.id);

        if (!result.triggered) {
            // Failed to trigger - mark as failed
            await supabase
                .from('task_runs')
                .update({
                    status: 'failed',
                    error: { code: 'claw_trigger_failed', message: result.error },
                    ended_at: new Date().toISOString()
                })
                .eq('id', run.id);

            await supabase
                .from('tasks')
                .update({ status: 'failed' })
                .eq('id', taskId);

            await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
                executor,
                error: result.error
            });

            return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: result.error }, error: result.error };
        }

        // Webhook triggered successfully - task stays in_progress until callback
        return { success: true, task: updatedTask, run: { ...run, status: 'running' } };

    } else {
        // Unknown executor
        const errorMsg = `Unknown executor type: ${executor}`;

        await supabase
            .from('task_runs')
            .update({
                status: 'failed',
                error: errorMsg,
                ended_at: new Date().toISOString()
            })
            .eq('id', run.id);

        await supabase
            .from('tasks')
            .update({ status: 'failed' })
            .eq('id', taskId);

        await logTaskRunActivity(task.customer_id, taskId, run.id, 'run_failed', 'error', {
            executor,
            error: errorMsg
        });

        return { success: false, task: { ...updatedTask, status: 'failed' }, run: { ...run, status: 'failed', error: errorMsg }, error: errorMsg };
    }
}
