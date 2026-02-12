import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { CreateSkillSchema } from '../schemas/openapi.js';
import { Skill } from '../types/index.js';

const router = Router();

// In-memory storage (replace with database in production)
const skills: Map<string, Skill> = new Map();

// Initialize with sample data
const sampleSkills: Skill[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Data Analysis',
    description: 'Analyze complex datasets and extract insights',
    category: 'Technical',
    level: 8,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'Project Management',
    description: 'Manage projects and coordinate teams',
    category: 'Management',
    level: 7,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'Communication',
    description: 'Effective verbal and written communication',
    category: 'Soft Skills',
    level: 9,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

sampleSkills.forEach(skill => skills.set(skill.id, skill));

/**
 * GET /api/skills - Get all skills
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const skillList = Array.from(skills.values());
    
    res.json({
      success: true,
      data: skillList,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /api/skills/:id - Get skill by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const skill = skills.get(id);

    if (!skill) {
      throw new AppError('Skill not found', 404, 'SKILL_NOT_FOUND');
    }

    res.json({
      success: true,
      data: skill,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /api/skills - Create new skill
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const validated = CreateSkillSchema.parse(req.body);
    
    const newSkill: Skill = {
      id: crypto.randomUUID(),
      ...validated,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    skills.set(newSkill.id, newSkill);

    res.status(201).json({
      success: true,
      data: newSkill,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * PUT /api/skills/:id - Update skill
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existingSkill = skills.get(id);

    if (!existingSkill) {
      throw new AppError('Skill not found', 404, 'SKILL_NOT_FOUND');
    }

    const validated = CreateSkillSchema.partial().parse(req.body);
    
    const updatedSkill: Skill = {
      ...existingSkill,
      ...validated,
      updatedAt: new Date().toISOString()
    };

    skills.set(id, updatedSkill);

    res.json({
      success: true,
      data: updatedSkill,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * DELETE /api/skills/:id - Delete skill
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    if (!skills.has(id)) {
      throw new AppError('Skill not found', 404, 'SKILL_NOT_FOUND');
    }

    skills.delete(id);

    res.json({
      success: true,
      data: { deleted: true, id },
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;
