import { Router } from 'express';
import gatewaySocket from '../services/gatewaySocket.js';

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
    version: process.env.npm_package_version || '1.0.0',
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
    timestamp: new Date().toISOString()
  });
});

export default router;
