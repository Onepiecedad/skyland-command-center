import { Router, Request, Response } from 'express';
import { reapStuckRuns } from '../services/taskService';

const router = Router();

// POST /admin/reaper/run - trigger reaper manually (one-shot)
router.post('/admin/reaper/run', async (_req: Request, res: Response) => {
    try {
        await reapStuckRuns();
        return res.json({ message: 'Reaper executed successfully' });
    } catch (err) {
        console.error('Manual reaper error:', err);
        return res.status(500).json({ error: 'Reaper execution failed' });
    }
});

export default router;
