import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import skillsRouter from './skills.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import { errorHandler } from '../middleware/errorHandler.js';

// Setup test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/skills', skillsRouter);
  app.use(errorHandler);
  return app;
};

describe('Skills API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('GET /api/skills', () => {
    it('should return all skills', async () => {
      const response = await request(app)
        .get('/api/skills')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.requestId).toBeDefined();
    });
  });

  describe('GET /api/skills/:id', () => {
    it('should return a skill by ID', async () => {
      const skillId = '550e8400-e29b-41d4-a716-446655440001';
      
      const response = await request(app)
        .get(`/api/skills/${skillId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(skillId);
      expect(response.body.data.name).toBeDefined();
    });

    it('should return 404 for non-existent skill', async () => {
      const response = await request(app)
        .get('/api/skills/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SKILL_NOT_FOUND');
    });
  });

  describe('POST /api/skills', () => {
    it('should create a new skill', async () => {
      const newSkill = {
        name: 'New Test Skill',
        description: 'A new skill for testing',
        category: 'Test',
        level: 7
      };

      const response = await request(app)
        .post('/api/skills')
        .send(newSkill)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(newSkill.name);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.active).toBe(true);
    });

    it('should return 400 for invalid skill data', async () => {
      const invalidSkill = {
        name: '', // Invalid: empty name
        description: 'Test',
        category: 'Test',
        level: 15 // Invalid: level > 10
      };

      const response = await request(app)
        .post('/api/skills')
        .send(invalidSkill)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/skills/:id', () => {
    it('should update an existing skill', async () => {
      const skillId = '550e8400-e29b-41d4-a716-446655440001';
      const updates = {
        level: 9
      };

      const response = await request(app)
        .put(`/api/skills/${skillId}`)
        .send(updates)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.level).toBe(9);
    });
  });

  describe('DELETE /api/skills/:id', () => {
    it('should delete an existing skill', async () => {
      // First, create a skill to delete
      const newSkill = await request(app)
        .post('/api/skills')
        .send({
          name: 'Skill to Delete',
          description: 'Will be deleted',
          category: 'Test',
          level: 5
        });

      const skillId = newSkill.body.data.id;

      const response = await request(app)
        .delete(`/api/skills/${skillId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
    });
  });
});
