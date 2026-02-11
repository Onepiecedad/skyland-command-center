/**
 * Creates a testable Express app (without starting the server).
 * This imports the real app setup but skips server.listen().
 */

import express from 'express';
import cors from 'cors';

// These are imported AFTER setup.ts has set the env vars
import healthRouter from '../../routes/health';
import costsRouter from '../../routes/costs';
import { authMiddleware } from '../../middleware/auth';
import { globalLimiter } from '../../middleware/rateLimiter';

export function createTestApp() {
    const app = express();

    app.use(cors());
    app.use(express.json());

    // Health — before auth (matches real app)
    app.use('/api/v1', healthRouter);

    // Auth middleware
    app.use(globalLimiter);
    app.use('/api/v1', authMiddleware);

    // Protected routes
    app.use('/api/v1/costs', costsRouter);

    return app;
}
