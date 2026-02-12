import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';
import { createServer } from 'http';

// Load environment variables
dotenv.config();

// Import middleware
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Import routes
import skillsRouter from './routes/skills.js';
import activitiesRouter from './routes/activities.js';
import healthRouter from './routes/health.js';
import customersRouter from './routes/customers.js';
import tasksRouter from './routes/tasks.js';
import runsRouter from './routes/runs.js';
import chatRouter from './routes/chat.js';
import archiveRouter from './routes/archive.js';
import costsRouter from './routes/costs.js';
import ideasRouter from './routes/ideas.js';
import skillRegistryRouter from './routes/skillRegistry.js';
import skillsAggregatorRouter from './routes/skillsAggregator.js';
import skillCheckerRouter from './routes/skillChecker.js';
import gitOpsRouter from './routes/gitOps.js';
import agentQueueRouter from './routes/agentQueue.js';
import contextDataRouter from './routes/contextData.js';
import toolCallsRouter from './routes/toolCalls.js';
import eventStreamRouter from './routes/eventStream.js';
import dispatchRouter from './routes/dispatch.js';
import progressRouter from './routes/progress.js';
import reportsRouter from './routes/reports.js';
import errorRecoveryRouter from './routes/errorRecovery.js';
import memoryManagementRouter from './routes/memoryManagement.js';
import memorySearchRouter from './routes/memorySearch.js';
import alexMemoryRouter from './routes/alexMemory.js';
import adminRouter from './routes/admin.js';
import openworkWebhookRouter from './routes/openworkWebhook.js';
import voiceRouter from './routes/voice.js';

// Import services
import gatewaySocket from './services/gatewaySocket.js';
import supabaseRealtime from './services/supabaseRealtime.js';

// Import OpenAPI doc generator
import { generateOpenApiDoc } from './docs/openapi.js';

// Import logger
import logger from './utils/logger.js';

/**
 * Skyland Command Center API Server
 */
class Server {
  public app: Application;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);

    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  /**
   * Initialize Express middleware
   */
  private initializeMiddleware(): void {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          imgSrc: ["'self'", "data:", "https:"],
        }
      }
    }));

    // CORS
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
    }));

    // Request ID middleware (must be before routes)
    this.app.use(requestIdMiddleware);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, _res, next) => {
      logger.info({
        message: 'Incoming request',
        method: req.method,
        path: req.path,
        requestId: req.requestId,
        ip: req.ip
      });
      next();
    });
  }

  /**
   * Initialize API routes
   */
  private initializeRoutes(): void {
    // API Documentation (Swagger UI)
    const openApiDoc = generateOpenApiDoc();
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

    // Serve OpenAPI spec as JSON
    this.app.get('/api-docs.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(openApiDoc);
    });

    // Health check
    this.app.use('/health', healthRouter);

    // Legacy API routes (used by Alex tab via axiosConfig baseURL: '/api')
    this.app.use('/api/skills', skillsRouter);
    this.app.use('/api/activities', activitiesRouter);

    // ================================================================
    // API v1 routes (used by frontend api.ts with API_BASE /api/v1)
    // ================================================================
    this.app.use('/api/v1/skills', skillRegistryRouter);       // File-based skill registry
    this.app.use('/api/v1/skills-db', skillsRouter);           // DB-backed skills (fallback)
    this.app.use('/api/v1/activities', activitiesRouter);
    this.app.use('/api/v1/customers', customersRouter);
    this.app.use('/api/v1/tasks', tasksRouter);
    this.app.use('/api/v1/runs', runsRouter);
    this.app.use('/api/v1/chat', chatRouter);
    this.app.use('/api/v1/archive', archiveRouter);
    this.app.use('/api/v1/costs', costsRouter);
    this.app.use('/api/v1/ideas', ideasRouter);
    this.app.use('/api/v1/skills-aggregator', skillsAggregatorRouter);
    this.app.use('/api/v1/skill-checker', skillCheckerRouter);
    this.app.use('/api/v1/git', gitOpsRouter);
    this.app.use('/api/v1/agent-queue', agentQueueRouter);
    this.app.use('/api/v1/context', contextDataRouter);
    this.app.use('/api/v1/tools', toolCallsRouter);
    this.app.use('/api/v1/events', eventStreamRouter);
    this.app.use('/api/v1/dispatch', dispatchRouter);
    this.app.use('/api/v1/progress', progressRouter);
    this.app.use('/api/v1/reports', reportsRouter);
    this.app.use('/api/v1/recovery', errorRecoveryRouter);
    this.app.use('/api/v1/memory', memoryManagementRouter);
    this.app.use('/api/v1/memory', memorySearchRouter);
    this.app.use('/api/v1/alex-memory', alexMemoryRouter);
    this.app.use('/api/v1/admin', adminRouter);
    this.app.use('/api/v1/webhooks/openwork', openworkWebhookRouter);
    this.app.use('/api/v1/voice', voiceRouter);

    // Root endpoint
    this.app.get('/', (_req, res) => {
      res.json({
        name: 'Skyland Command Center API',
        version: '1.0.0',
        documentation: '/api-docs',
        health: '/health',
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Initialize error handling (must be last)
   */
  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);
  }

  /**
   * Start the server
   */
  public start(): void {
    // Create HTTP server (needed for WebSocket)
    this.httpServer = createServer(this.app);

    // Initialize WebSocket gateway
    gatewaySocket.initialize(this.httpServer);

    // Initialize Supabase realtime (optional)
    supabaseRealtime.initialize();

    // Start listening
    this.httpServer.listen(this.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════════════╗
║       Skyland Command Center API Server                  ║
╠══════════════════════════════════════════════════════════╣
║  Environment: ${process.env.NODE_ENV || 'development'}
║  Port: ${this.port}
║  API Docs: http://localhost:${this.port}/api-docs
║  Health: http://localhost:${this.port}/health
╚══════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown...`);

      // Stop accepting new connections
      if (this.httpServer) {
        this.httpServer.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Cleanup services
      gatewaySocket.stop();
      supabaseRealtime.stop();

      logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection:', reason);
    });
  }
}

// Create and export server instance
const server = new Server();
export default server;

// Start server if this file is run directly
if (require.main === module) {
  server.start();
}
