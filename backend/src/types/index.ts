// Centralized Type Definitions

export interface ApiError {
  status: number;
  message: string;
  code: string;
  details?: Record<string, unknown>;
  requestId: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  requestId: string;
  timestamp: string;
}

// Skill Types
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  level: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  category: string;
  level: number;
}

// Archive/Activity Types
export interface Activity {
  id: string;
  type: 'task' | 'event' | 'system';
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateActivityRequest {
  type: 'task' | 'event' | 'system';
  title: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

// WebSocket Types
import type { WebSocket as WSWebSocket } from 'ws';

export interface WebSocketMessage {
  type: 'ping' | 'pong' | 'subscribe' | 'unsubscribe' | 'update' | 'error';
  channel?: string;
  payload?: unknown;
  timestamp: number;
}

export interface WSClient {
  id: string;
  socket: WSWebSocket;
  subscriptions: Set<string>;
  lastPing: number;
  isAlive: boolean;
}
