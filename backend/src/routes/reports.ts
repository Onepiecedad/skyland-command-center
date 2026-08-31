import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../services/supabase';
import { collectDigest, renderDigest } from '../services/dailyDigest';
import { logger } from '../services/logger';

const router = Router();

/**
 * GET /reports/digest?hours=24
 *
 * Samma siffror som morgonmejlet (plan 3.2), som JSON plus färdig text.
 * Alex kvällssammanfattning läser den här i stället för att peta i himalaya
 * och Apple Kalender — verktyg som bara fanns på Macen och som därför kraschade
 * varje kväll efter flytten till VPS:en.
 */
router.get('/digest', async (req: Request, res: Response) => {
    try {
        const hours = Math.min(Math.max(Number(req.query.hours ?? 24) || 24, 1), 168);
        const data = await collectDigest(new Date(), hours * 3600_000);
        const { subject, text } = renderDigest(data);
        return res.json({ hours, subject, text, data });
    } catch (err) {
        logger.error('reports', `digest: ${err instanceof Error ? err.message : err}`);
        return res.status(500).json({ error: 'Kunde inte bygga rapporten' });
    }
});

// GET /reports/:task_id - download report PDF for a task
router.get('/reports/:task_id', async (req: Request, res: Response) => {
    try {
        const taskId = req.params.task_id as string;

        // Validate UUID format
        const uuidSchema = z.string().uuid();
        const uuidParsed = uuidSchema.safeParse(taskId);

        if (!uuidParsed.success) {
            return res.status(400).json({ error: 'Invalid task_id format' });
        }

        // Get task to find report path
        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .select('output, status, title')
            .eq('id', taskId)
            .single();

        if (taskError || !task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        if (task.status !== 'completed') {
            return res.status(400).json({ error: 'Report not yet generated', status: task.status });
        }

        // Check for report path in output
        const output = task.output as Record<string, unknown> | null;
        const reportPath = (output?.report_path || output?.desktop_path) as string | null;

        if (!reportPath) {
            // Try default path based on task ID
            const defaultPath = path.join(
                process.env.HOME || '',
                '.openclaw/output',
                taskId,
                'rapport.pdf'
            );

            if (fs.existsSync(defaultPath)) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${task.title || 'rapport'}.pdf"`);
                return fs.createReadStream(defaultPath).pipe(res);
            }

            return res.status(404).json({ error: 'Report file not found', checked_path: defaultPath });
        }

        // Serve the PDF file
        const absolutePath = reportPath.replace('~', process.env.HOME || '');

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ error: 'Report file not found', path: reportPath });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${task.title || 'rapport'}.pdf"`);
        return fs.createReadStream(absolutePath).pipe(res);

    } catch (err) {
        console.error('Report download error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
