import { z } from 'zod';
import {
  OpenApiGeneratorV3,
  OpenAPIRegistry
} from '@asteasolutions/zod-to-openapi';
import {
  SkillSchema,
  CreateSkillSchema,
  ActivitySchema,
  CreateActivitySchema,
  ApiResponseSchema
} from '../schemas/openapi.js';

/**
 * OpenAPI Registry and Document Generator
 */
const registry = new OpenAPIRegistry();

// Register schemas
registry.register('Skill', SkillSchema);
registry.register('CreateSkill', CreateSkillSchema);
registry.register('Activity', ActivitySchema);
registry.register('CreateActivity', CreateActivitySchema);

// Skill endpoints
registry.registerPath({
  method: 'get',
  path: '/api/skills',
  description: 'Get all skills',
  tags: ['Skills'],
  responses: {
    200: {
      description: 'List of skills',
      content: {
        'application/json': {
          schema: ApiResponseSchema(z.array(SkillSchema))
        }
      }
    }
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/skills/{id}',
  description: 'Get a skill by ID',
  tags: ['Skills'],
  request: {
    params: z.object({
      id: z.string().uuid().describe('Skill ID')
    })
  },
  responses: {
    200: {
      description: 'Skill found',
      content: {
        'application/json': {
          schema: ApiResponseSchema(SkillSchema)
        }
      }
    },
    404: {
      description: 'Skill not found'
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/skills',
  description: 'Create a new skill',
  tags: ['Skills'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateSkillSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Skill created',
      content: {
        'application/json': {
          schema: ApiResponseSchema(SkillSchema)
        }
      }
    },
    400: {
      description: 'Validation error'
    }
  }
});

// Activity endpoints
registry.registerPath({
  method: 'get',
  path: '/api/activities',
  description: 'Get all activities',
  tags: ['Activities'],
  responses: {
    200: {
      description: 'List of activities',
      content: {
        'application/json': {
          schema: ApiResponseSchema(z.array(ActivitySchema))
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/activities',
  description: 'Create a new activity',
  tags: ['Activities'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateActivitySchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Activity created',
      content: {
        'application/json': {
          schema: ApiResponseSchema(ActivitySchema)
        }
      }
    },
    400: {
      description: 'Validation error'
    }
  }
});

// Generator
export const generator = new OpenApiGeneratorV3(registry.definitions);

export function generateOpenApiDoc() {
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Skyland Command Center API',
      description: 'API documentation for Skyland Command Center',
      contact: {
        name: 'Skyland AI Support',
        email: 'support@skyland.ai'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Default server'
      }
    ]
  });
}

export default registry;
