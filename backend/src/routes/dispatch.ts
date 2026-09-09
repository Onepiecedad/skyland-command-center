import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { dispatchSchema, n8nCallbackSchema, clawCallbackSchema, clawResearchOutputSchema } from '../schemas/dispatch';
import { dispatchTask, logTaskRunActivity } from '../services/taskService';
import { notePollerSeen } from '../services/pollerWatchdog';

const router = Router();

// POST /tasks/:id/dispatch - dispatch a task for execution
router.post('/tasks/:id/dispatch', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;

        const parsed = dispatchSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const result = await dispatchTask(id, parsed.data.worker_id);

        if (!result.success) {
            return res.status(400).json({
                error: result.error,
                task: result.task,
                run: result.run
            });
        }

        return res.json({
            message: 'Task dispatched successfully',
            task: result.task,
            run: result.run
        });
    } catch (err) {
        console.error('Unexpected error dispatching task:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /n8n/task-result - callback for n8n task completion
router.post('/n8n/task-result', async (req: Request, res: Response) => {
    try {
        const parsed = n8nCallbackSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { task_id, run_id, success, output, error } = parsed.data;

        // Get existing run to fetch task info
        const { data: run, error: runError } = await supabase
            .from('task_runs')
            .select('*, tasks(customer_id)')
            .eq('id', run_id)
            .single();

        if (runError || !run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        const now = new Date().toISOString();

        // Update task_run with error checking
        const { error: runUpdateError } = await supabase
            .from('task_runs')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {},
                error: error ? { message: error } : {},
                ended_at: now
            })
            .eq('id', run_id);

        if (runUpdateError) {
            console.error('Failed to update task_run:', runUpdateError);
            return res.status(500).json({
                error: 'Failed to update run',
                details: runUpdateError.message
            });
        }

        // Update task with error checking
        const { error: taskUpdateError } = await supabase
            .from('tasks')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {}
            })
            .eq('id', task_id);

        if (taskUpdateError) {
            console.error('Failed to update task:', taskUpdateError);
        }

        console.log(`[n8n-callback] Updated run ${run_id} to ${success ? 'completed' : 'failed'}`);

        // Log activity
        const customerId = (run as Record<string, unknown>).tasks
            ? ((run as Record<string, unknown>).tasks as Record<string, unknown>).customer_id as string | null
            : null;

        await logTaskRunActivity(
            customerId,
            task_id,
            run_id,
            success ? 'run_completed' : 'run_failed',
            success ? 'info' : 'error',
            success ? { output } : { error }
        );

        return res.json({
            message: success ? 'Task completed' : 'Task failed',
            task_id,
            run_id,
            status: success ? 'completed' : 'failed'
        });
    } catch (err) {
        console.error('Unexpected error in n8n callback:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /claw/task-result - callback for OpenClaw task completion
router.post('/claw/task-result', async (req: Request, res: Response) => {
    try {
        const parsed = clawCallbackSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { task_id, run_id, success, output, error } = parsed.data;

        // Get existing run to fetch task info
        const { data: run, error: runError } = await supabase
            .from('task_runs')
            .select('*, tasks(customer_id)')
            .eq('id', run_id)
            .single();

        if (runError || !run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        // Best-effort output schema validation for claw:research (Ticket 20)
        let schemaWarning: string | null = null;
        if (success && output && run.executor === 'claw:research') {
            const schemaResult = clawResearchOutputSchema.safeParse(output);
            if (!schemaResult.success) {
                schemaWarning = `Output schema mismatch for claw:research: ${schemaResult.error.issues.map(i => i.message).join(', ')}`;
                console.warn(`[claw-callback] ${schemaWarning}`);
                // Log warning activity
                try {
                    await supabase.from('activities').insert({
                        customer_id: (run as Record<string, unknown>).tasks
                            ? ((run as Record<string, unknown>).tasks as Record<string, unknown>).customer_id
                            : null,
                        agent: 'system:validator',
                        event_type: 'schema_validation',
                        action: 'schema_mismatch',
                        severity: 'warn',
                        details: {
                            task_id,
                            run_id,
                            executor: run.executor,
                            issues: schemaResult.error.issues
                        }
                    });
                } catch (logErr) {
                    console.error('Failed to log schema warning:', logErr);
                }
            }
        }

        const now = new Date().toISOString();

        // Update task_run with error checking
        const { error: runUpdateError } = await supabase
            .from('task_runs')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {},
                error: error ? { message: error } : {},
                ended_at: now
            })
            .eq('id', run_id);

        if (runUpdateError) {
            console.error('Failed to update task_run:', runUpdateError);
            return res.status(500).json({
                error: 'Failed to update run',
                details: runUpdateError.message
            });
        }

        // Update task with error checking
        const { error: taskUpdateError } = await supabase
            .from('tasks')
            .update({
                status: success ? 'completed' : 'failed',
                output: output || {}
            })
            .eq('id', task_id);

        if (taskUpdateError) {
            console.error('Failed to update task:', taskUpdateError);
        }

        console.log(`[claw-callback] Updated run ${run_id} to ${success ? 'completed' : 'failed'}`);

        // Log activity
        const customerId = (run as Record<string, unknown>).tasks
            ? ((run as Record<string, unknown>).tasks as Record<string, unknown>).customer_id as string | null
            : null;

        await logTaskRunActivity(
            customerId,
            task_id,
            run_id,
            success ? 'run_completed' : 'run_failed',
            success ? 'info' : 'error',
            success ? { output, source: 'openclaw' } : { error, source: 'openclaw' }
        );

        // Kom uppdraget från Alex-panelen (delegate_task)? Då väntar en människa
        // på svaret där, inte i en tasklista. Skicka det till skärmen.
        try {
            const { data: t } = await supabase.from('tasks').select('input, title').eq('id', task_id).maybeSingle();
            const input = (t?.input ?? {}) as Record<string, unknown>;
            if (input.source === 'panel') {
                const { emitSystemEvent } = await import('./eventStream');
                const rubrik = String(t?.title ?? 'Uppdraget').slice(0, 60);
                const svar = success
                    ? readableOutput(output, rubrik)
                    : (() => {
                        const rad = `Uppdraget "${rubrik}" misslyckades: ${error ?? 'okänt fel'}`;
                        return { text: rad, speech: rad };
                    })();
                emitSystemEvent('ui_action', {
                    action: 'note',
                    text: svar.text,
                    speech: svar.speech,
                    speak: true,
                    source: 'delegate',
                }, 'alex');
            }
        } catch (err) {
            console.error('[claw-callback] kunde inte skicka svaret till panelen:', err);
        }

        return res.json({
            message: success ? 'Task completed' : 'Task failed',
            task_id,
            run_id,
            status: success ? 'completed' : 'failed'
        });
    } catch (err) {
        console.error('Unexpected error in claw callback:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Gör agentens svar begripligt för en människa — och särskilt för ett ÖRA.
 *
 * Bakgrund: 9 sep läste Alex upp en hel JSON-blob i högtalaren, med
 * klammerparenteser och engelska nyckelnamn, för att researchagenten svarade
 * med ett strukturerat objekt utan sammanfattning. Därför två spår: `text`
 * är det som visas i tråden, `speech` det som läses upp. Saknas prosa görs
 * en läsbar sammanställning för ögat och en kort mening för örat.
 */
export function readableOutput(output: unknown, rubrik = 'Uppdraget'): { text: string; speech: string } {
    const klipp = (v: string, n = 3000) => (v.length > n ? v.slice(0, n) + '…' : v);

    if (typeof output === 'string' && output.trim()) {
        return { text: klipp(output), speech: klipp(output, 1000) };
    }

    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const o = output as Record<string, unknown>;
        for (const key of ['summary', 'sammanfattning', 'answer', 'svar', 'result', 'text', 'message']) {
            const v = o[key];
            if (typeof v === 'string' && v.trim()) {
                const rest = Object.keys(o).filter(k => k !== key).length;
                return {
                    text: klipp(v) + (rest ? `\n\n(Agenten skickade även ${rest} fält med detaljer.)` : ''),
                    speech: klipp(v, 1000),
                };
            }
        }

        // Ingen prosa: vik ut objektet till rader i stället för att visa rå JSON.
        const rader: string[] = [];
        const värde = (v: unknown): string => {
            if (v === null || v === undefined) return '';
            if (Array.isArray(v)) {
                return v.map(x => (x && typeof x === 'object'
                    ? Object.values(x as Record<string, unknown>).filter(y => typeof y === 'string').join(', ')
                    : String(x))).filter(Boolean).join(' · ');
            }
            if (typeof v === 'object') {
                return Object.entries(v as Record<string, unknown>)
                    .map(([k2, v2]) => `${k2}: ${typeof v2 === 'object' ? JSON.stringify(v2) : String(v2)}`)
                    .join(', ');
            }
            return String(v);
        };
        for (const [k, v] of Object.entries(o)) {
            const rad = värde(v).trim();
            if (rad) rader.push(`${k.replace(/_/g, ' ')}: ${rad}`);
        }
        if (rader.length) {
            return {
                text: klipp(rader.join('\n')),
                speech: `${rubrik} är klart. Resultatet är för detaljerat för att läsa upp — det står i tråden.`,
            };
        }
    }

    const tomt = `${rubrik} är klart, men agenten skickade inget läsbart resultat.`;
    return { text: tomt, speech: tomt };
}

// GET /claw/pending - PULL-läge: pollern på Macen hämtar köade claw-körningar.
// Render (moln) kan inte pusha till gatewayn på Macens localhost, så vi vänder på
// kopplingen: dispatchern köar körningen (worker_id='pull:queued'), och denna
// endpoint listar + CLAIMAR dem atomiskt (queued→claimed) så en körning aldrig
// dubbelkörs. Pollern avfyrar sedan agenten lokalt och rapporterar via /claw/task-result.
// Bakom global Bearer-auth (SCC_API_TOKEN) — samma token pollern redan har.
router.get('/claw/pending', async (req: Request, res: Response) => {
    try {
        const worker = typeof req.query.worker === 'string' && req.query.worker
            ? req.query.worker
            : `mac-${Date.now()}`;

        // Hjärtslag till poller-vakten (plan 3.3). Måste ligga före allt som kan
        // kasta — pollern hörs av även när kön är tom eller Supabase strular, och
        // det är just "hörs av" vi vaktar på.
        notePollerSeen(worker);
        const limit = Math.min(parseInt(String(req.query.limit ?? '5'), 10) || 5, 25);

        const { data: runs, error } = await supabase
            .from('task_runs')
            .select('id, task_id, executor, input_snapshot, tasks(title, customer_id, input)')
            .eq('status', 'running')
            .eq('worker_id', 'pull:queued')
            .like('executor', 'claw:%')
            .order('queued_at', { ascending: true })
            .limit(limit);

        if (error) {
            console.error('Error fetching pending claw runs:', error);
            return res.status(500).json({ error: error.message });
        }

        const pending: Array<Record<string, unknown>> = [];
        for (const r of runs ?? []) {
            // Atomisk claim: uppdatera bara om den fortfarande är 'pull:queued'.
            const { data: claimed } = await supabase
                .from('task_runs')
                .update({ worker_id: `pull:claimed:${worker}` })
                .eq('id', r.id)
                .eq('worker_id', 'pull:queued')
                .select('id')
                .maybeSingle();

            if (!claimed) continue; // en annan poller hann före

            const task = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks as
                { title?: string; customer_id?: string | null; input?: unknown } | null;

            pending.push({
                task_id: r.task_id,
                run_id: r.id,
                agent_id: (r.executor as string).replace('claw:', ''),
                prompt: task?.title ?? '',
                input: task?.input ?? r.input_snapshot ?? {},
                customer_id: task?.customer_id ?? null,
            });
        }

        return res.json({ pending, count: pending.length, worker });
    } catch (err) {
        console.error('Unexpected error in claw pending:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
