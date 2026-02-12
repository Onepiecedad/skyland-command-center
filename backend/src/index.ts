import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables before importing anything else
dotenv.config();

// Validate all env vars immediately (exits if invalid)
import { config } from './config';
import { logger } from './services/logger';

// --- Route modules (Fas 1 extracted) ---
import healthRouter from './routes/health';
import customersRouter from './routes/customers';
import activitiesRouter from './routes/activities';
import tasksRouter from './routes/tasks';
import runsRouter from './routes/runs';
import dispatchRouter from './routes/dispatch';
import chatRouter from './routes/chat';
import reportsRouter from './routes/reports';
import progressRouter from './routes/progress';
import costsRouter from './routes/costs';
import adminRouter from './routes/admin';
import skillsAggregatorRouter from './routes/skillsAggregator';

// --- Route modules (Phase 2 — already extracted) ---
import skillRegistryRouter from './routes/skillRegistry';
import skillCheckerRouter from './routes/skillChecker';
import agentQueueRouter from './routes/agentQueue';
import gitOpsRouter from './routes/gitOps';
import contextDataRouter from './routes/contextData';
import toolCallsRouter from './routes/toolCalls';
import eventStreamRouter from './routes/eventStream';
import errorRecoveryRouter from './routes/errorRecovery';
import memorySearchRouter from './routes/memorySearch';
import memoryManagementRouter from './routes/memoryManagement';
import alexMemoryRouter from './routes/alexMemory';
import openworkWebhookRouter from './routes/openworkWebhook';
import archiveRouter from './routes/archive';

// --- Middleware ---
import { authMiddleware } from './middleware/auth';
import { globalLimiter, chatLimiter, adminLimiter } from './middleware/rateLimiter';

// --- Services ---
import { reapStuckRuns } from './services/taskService';

const app = express();
const PORT = config.PORT;

// ============================================================================
// Middleware — base
// ============================================================================
app.use(cors());
app.use(express.json());

// ============================================================================
// Health routes — BEFORE auth (must stay open for probes)
// ============================================================================
app.use('/api/v1', healthRouter);           // GET /health, GET /status

// ============================================================================
// Auth + Rate Limiting — protects everything below
// ============================================================================
app.use(globalLimiter);
app.use('/api/v1', authMiddleware);

// ============================================================================
// Mount route modules — Fas 1 (auth-protected)
// ============================================================================
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/activities', activitiesRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1', runsRouter);             // GET /tasks/:id/runs, GET /runs
app.use('/api/v1', dispatchRouter);         // POST /tasks/:id/dispatch, n8n & claw callbacks
app.use('/api/v1', chatLimiter, chatRouter);             // POST /chat, GET /chat/history (extra rate limit)
app.use('/api/v1', reportsRouter);          // GET /reports/:task_id
app.use('/api/v1', progressRouter);         // GET/POST /tasks/:id/progress
app.use('/api/v1/costs', costsRouter);
app.use('/api/v1', adminLimiter, adminRouter);            // POST /admin/reaper/run (extra rate limit)
app.use('/api/v1', skillsAggregatorRouter); // GET /skills

// ============================================================================
// Mount route modules — Phase 2 (auth-protected)
// ============================================================================
app.use('/api/v1/skills', skillCheckerRouter);
app.use('/api/v1/skills', skillRegistryRouter);
app.use('/api/v1/agent-queue', agentQueueRouter);
app.use('/api/v1/git', gitOpsRouter);
app.use('/api/v1/context', contextDataRouter);
app.use('/api/v1/tools', toolCallsRouter);
app.use('/api/v1/events', eventStreamRouter);
app.use('/api/v1/recovery', errorRecoveryRouter);
app.use('/api/v1/memory', memorySearchRouter);
app.use('/api/v1/memory', memoryManagementRouter);
app.use('/api/v1/alex', alexMemoryRouter);
app.use('/api/v1/webhook', openworkWebhookRouter);
app.use('/api/v1/archive', archiveRouter);

// ============================================================================
// Reaper Timer — timeouts stuck running task_runs
// ============================================================================
const reaperIntervalSeconds = config.TASK_RUN_REAPER_INTERVAL_SECONDS;
const timeoutMinutes = config.TASK_RUN_TIMEOUT_MINUTES;
setInterval(reapStuckRuns, reaperIntervalSeconds * 1000);
logger.info('reaper', `Reaper started (interval: ${reaperIntervalSeconds}s, timeout: ${timeoutMinutes}m)`);

// ============================================================================
// Start server
// ============================================================================
app.listen(PORT, () => {
    logger.info('server', `Skyland Command Center API running on port ${PORT}`);
});
