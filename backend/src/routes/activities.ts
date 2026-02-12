import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { CreateActivitySchema } from '../schemas/openapi.js';
import { Activity } from '../types/index.js';
import gatewaySocket from '../services/gatewaySocket.js';

const router = Router();

// In-memory storage (replace with database in production)
const activities: Map<string, Activity> = new Map();

// Initialize with sample data
const sampleActivities: Activity[] = [
  {
    id: '660e8400-e29b-41d4-a716-446655440001',
    type: 'task',
    title: 'Review Q4 Financial Reports',
    description: 'Analyze and review the quarterly financial performance',
    status: 'in_progress',
    priority: 'high',
    metadata: { assignee: 'finance-team', deadline: '2024-01-31' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '660e8400-e29b-41d4-a716-446655440002',
    type: 'event',
    title: 'System Maintenance Window',
    description: 'Scheduled maintenance for database optimization',
    status: 'pending',
    priority: 'medium',
    metadata: { duration: '2 hours', affected: 'all-services' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '660e8400-e29b-41d4-a716-446655440003',
    type: 'system',
    title: 'Security Patch Applied',
    description: 'Automated security patch deployment completed',
    status: 'completed',
    priority: 'critical',
    metadata: { patch_version: '2024.1.1', affected_systems: 5 },
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }
];

sampleActivities.forEach(activity => activities.set(activity.id, activity));

/**
 * GET /api/activities - Get all activities
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, type, priority } = req.query;
    
    let activityList = Array.from(activities.values());

    // Apply filters if provided (handle string | string[] types from query params)
    if (status && typeof status === 'string') {
      activityList = activityList.filter(a => a.status === status);
    }
    if (type && typeof type === 'string') {
      activityList = activityList.filter(a => a.type === type);
    }
    if (priority && typeof priority === 'string') {
      activityList = activityList.filter(a => a.priority === priority);
    }

    // Sort by creation date (newest first)
    activityList.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: activityList,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /api/activities/:id - Get activity by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const activity = activities.get(id);

    if (!activity) {
      throw new AppError('Activity not found', 404, 'ACTIVITY_NOT_FOUND');
    }

    res.json({
      success: true,
      data: activity,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /api/activities - Create new activity
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const validated = CreateActivitySchema.parse(req.body);
    
    const newActivity: Activity = {
      id: crypto.randomUUID(),
      ...validated,
      priority: validated.priority || 'medium',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    activities.set(newActivity.id, newActivity);

    // Broadcast to WebSocket clients
    gatewaySocket.broadcast({
      type: 'update',
      channel: 'activities',
      payload: { 
        event: 'activity_created', 
        activity: newActivity 
      },
      timestamp: Date.now()
    }, 'activities');

    res.status(201).json({
      success: true,
      data: newActivity,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * PUT /api/activities/:id - Update activity
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existingActivity = activities.get(id);

    if (!existingActivity) {
      throw new AppError('Activity not found', 404, 'ACTIVITY_NOT_FOUND');
    }

    const validated = CreateActivitySchema.partial().parse(req.body);
    const bodyStatus = req.body.status as Activity['status'] | undefined;
    
    const updatedActivity: Activity = {
      ...existingActivity,
      ...validated,
      status: bodyStatus || existingActivity.status,
      updatedAt: new Date().toISOString(),
      completedAt: bodyStatus === 'completed' 
        ? new Date().toISOString() 
        : existingActivity.completedAt
    };

    activities.set(id, updatedActivity);

    // Broadcast update to WebSocket clients
    gatewaySocket.broadcast({
      type: 'update',
      channel: 'activities',
      payload: { 
        event: 'activity_updated', 
        activity: updatedActivity 
      },
      timestamp: Date.now()
    }, 'activities');

    res.json({
      success: true,
      data: updatedActivity,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * PATCH /api/activities/:id/status - Update activity status
 */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const existingActivity = activities.get(id);

    if (!existingActivity) {
      throw new AppError('Activity not found', 404, 'ACTIVITY_NOT_FOUND');
    }

    if (!['pending', 'in_progress', 'completed', 'failed'].includes(status)) {
      throw new AppError('Invalid status value', 400, 'INVALID_STATUS');
    }

    const updatedActivity: Activity = {
      ...existingActivity,
      status,
      updatedAt: new Date().toISOString(),
      completedAt: status === 'completed' 
        ? new Date().toISOString() 
        : existingActivity.completedAt
    };

    activities.set(id, updatedActivity);

    // Broadcast status change
    gatewaySocket.broadcast({
      type: 'update',
      channel: 'activities',
      payload: { 
        event: 'activity_status_changed', 
        activityId: id,
        status,
        activity: updatedActivity
      },
      timestamp: Date.now()
    }, 'activities');

    res.json({
      success: true,
      data: updatedActivity,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * DELETE /api/activities/:id - Delete activity
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    if (!activities.has(id)) {
      throw new AppError('Activity not found', 404, 'ACTIVITY_NOT_FOUND');
    }

    activities.delete(id);

    // Broadcast deletion
    gatewaySocket.broadcast({
      type: 'update',
      channel: 'activities',
      payload: { 
        event: 'activity_deleted', 
        activityId: id 
      },
      timestamp: Date.now()
    }, 'activities');

    res.json({
      success: true,
      data: { deleted: true, id },
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
