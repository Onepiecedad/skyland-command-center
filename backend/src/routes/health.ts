import { Router } from 'express';
import gatewaySocket from '../services/gatewaySocket.js';
import { BUILD_INFO } from '../buildInfo.js';

const router = Router();

/**
 * GET /health - Health check endpoint
 */
router.get('/', (_req, res) => {
  const wsStats = gatewaySocket.getStats();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: BUILD_INFO.version,
    commit: BUILD_INFO.commitShort,
    commitFull: BUILD_INFO.commit,
    startedAt: BUILD_INFO.startedAt,
    environment: process.env.NODE_ENV || 'development',
    services: {
      websocket: {
        status: wsStats.activeConnections >= 0 ? 'up' : 'down',
        connections: wsStats.activeConnections,
        stats: wsStats
      }
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  };

  res.json(health);
});

/**
 * GET /health/ready - Readiness check for Kubernetes/Docker
 */
router.get('/ready', (_req, res) => {
  res.status(200).json({
    status: 'ready',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /health/live - Liveness check for Kubernetes/Docker
 */
router.get('/live', (_req, res) => {
  res.status(200).json({
    status: 'alive',
    // commit + startedAt make this endpoint answer "is my deploy live?" —
    // compare commit against `git log --oneline -1`.
    commit: BUILD_INFO.commitShort,
    startedAt: BUILD_INFO.startedAt,
    timestamp: new Date().toISOString()
  });
});

export default router;
