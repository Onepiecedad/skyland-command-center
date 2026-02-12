import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// The schemas below use the .openapi() extension method

/**
 * Reusable Schema Components
 */

// Skill Schemas
export const SkillSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Unique skill identifier', example: '550e8400-e29b-41d4-a716-446655440000' }),
  name: z.string().min(1).max(100).openapi({ description: 'Skill name', example: 'Data Analysis' }),
  description: z.string().min(1).max(500).openapi({ description: 'Skill description', example: 'Analyze complex datasets' }),
  category: z.string().min(1).max(50).openapi({ description: 'Skill category', example: 'Technical' }),
  level: z.number().int().min(1).max(10).openapi({ description: 'Skill level (1-10)', example: 5 }),
  active: z.boolean().openapi({ description: 'Whether the skill is active', example: true }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp', example: '2024-01-15T10:00:00Z' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp', example: '2024-01-15T10:00:00Z' })
}).openapi('Skill');

export const CreateSkillSchema = z.object({
  name: z.string().min(1).max(100).openapi({ description: 'Skill name', example: 'Data Analysis' }),
  description: z.string().min(1).max(500).openapi({ description: 'Skill description', example: 'Analyze complex datasets' }),
  category: z.string().min(1).max(50).openapi({ description: 'Skill category', example: 'Technical' }),
  level: z.number().int().min(1).max(10).openapi({ description: 'Skill level (1-10)', example: 5 })
}).openapi('CreateSkill');

// Activity/Archive Schemas
export const ActivitySchema = z.object({
  id: z.string().uuid().openapi({ description: 'Unique activity identifier' }),
  type: z.enum(['task', 'event', 'system']).openapi({ description: 'Activity type', example: 'task' }),
  title: z.string().min(1).max(200).openapi({ description: 'Activity title', example: 'Review Quarterly Report' }),
  description: z.string().min(1).max(1000).openapi({ description: 'Activity description' }),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).openapi({ description: 'Current status', example: 'pending' }),
  priority: z.enum(['low', 'medium', 'high', 'critical']).openapi({ description: 'Priority level', example: 'high' }),
  metadata: z.record(z.unknown()).optional().openapi({ description: 'Additional metadata' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
  completedAt: z.string().datetime().optional().openapi({ description: 'Completion timestamp' })
}).openapi('Activity');

export const CreateActivitySchema = z.object({
  type: z.enum(['task', 'event', 'system']).openapi({ description: 'Activity type', example: 'task' }),
  title: z.string().min(1).max(200).openapi({ description: 'Activity title', example: 'Review Quarterly Report' }),
  description: z.string().min(1).max(1000).openapi({ description: 'Activity description' }),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().openapi({ description: 'Priority level', example: 'high' }),
  metadata: z.record(z.unknown()).optional().openapi({ description: 'Additional metadata' })
}).openapi('CreateActivity');

// Error Schema
export const ErrorSchema = z.object({
  status: z.number().int().openapi({ description: 'HTTP status code', example: 400 }),
  message: z.string().openapi({ description: 'Error message', example: 'Validation Error' }),
  code: z.string().openapi({ description: 'Error code', example: 'VALIDATION_ERROR' }),
  details: z.record(z.unknown()).optional().openapi({ description: 'Additional error details' }),
  requestId: z.string().uuid().openapi({ description: 'Request tracking ID' })
}).openapi('Error');

// API Response Schema
export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean().openapi({ description: 'Whether the request was successful', example: true }),
    data: dataSchema.optional().openapi({ description: 'Response data' }),
    error: ErrorSchema.optional().openapi({ description: 'Error information if request failed' }),
    requestId: z.string().uuid().openapi({ description: 'Request tracking ID' }),
    timestamp: z.string().datetime().openapi({ description: 'Response timestamp' })
  }).openapi('ApiResponse');

// Type exports
export type Skill = z.infer<typeof SkillSchema>;
export type CreateSkill = z.infer<typeof CreateSkillSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type CreateActivity = z.infer<typeof CreateActivitySchema>;
export type ApiError = z.infer<typeof ErrorSchema>;
