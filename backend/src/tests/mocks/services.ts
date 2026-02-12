import { vi } from 'vitest';
import type { Skill, Activity } from '../../types/index.js';

// Mock data
export const mockSkills: Skill[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Test Skill',
    description: 'A test skill for unit tests',
    category: 'Test',
    level: 5,
    active: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  }
];

export const mockActivities: Activity[] = [
  {
    id: '660e8400-e29b-41d4-a716-446655440001',
    type: 'task',
    title: 'Test Activity',
    description: 'A test activity for unit tests',
    status: 'pending',
    priority: 'medium',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  }
];

// Mock gateway socket
export const mockGatewaySocket = {
  initialize: vi.fn(),
  broadcast: vi.fn(),
  getStats: vi.fn(() => ({
    totalConnections: 0,
    activeConnections: 0,
    messagesReceived: 0,
    messagesSent: 0,
    disconnections: 0,
    reconnections: 0
  })),
  getClientCount: vi.fn(() => 0),
  stop: vi.fn()
};

// Mock Supabase realtime
export const mockSupabaseRealtime = {
  initialize: vi.fn(() => true),
  broadcast: vi.fn(),
  getStatus: vi.fn(() => ({
    isInitialized: true,
    connectedChannels: ['activities', 'skills'],
    reconnectAttempts: 0
  })),
  stop: vi.fn()
};

// Mock logger
export const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};
