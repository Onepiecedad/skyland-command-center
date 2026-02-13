import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import logger from '../utils/logger.js';
import gatewaySocket from './gatewaySocket.js';

/**
 * Supabase Realtime Service
 * Manages realtime subscriptions and forwards updates to WebSocket clients
 */

interface SupabaseConfig {
  url: string;
  key: string;
}

class SupabaseRealtimeService {
  private client: SupabaseClient | null = null;
  private channels: Map<string, RealtimeChannel> = new Map();
  private isInitialized = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds

  /**
   * Initialize Supabase client and setup realtime subscriptions
   */
  initialize(config?: SupabaseConfig): boolean {
    if (this.isInitialized) {
      logger.warn('Supabase realtime already initialized');
      return true;
    }

    const supabaseUrl = config?.url || process.env.SUPABASE_URL;
    const supabaseKey = config?.key || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      logger.warn('Supabase credentials not found, running without realtime');
      return false;
    }

    try {
      this.client = createClient(supabaseUrl, supabaseKey, {
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });

      this.setupSubscriptions();
      this.isInitialized = true;
      this.reconnectAttempts = 0;

      logger.info('Supabase realtime initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Supabase realtime:', error);
      return false;
    }
  }

  /**
   * Setup realtime subscriptions for tables
   */
  private setupSubscriptions(): void {
    if (!this.client) return;

    // Subscribe to activities table changes
    this.subscribeToTable('activities');

    // Subscribe to skills table changes
    this.subscribeToTable('skills');

    // Subscribe to system events
    this.subscribeToTable('system_events');

    logger.info('Realtime subscriptions configured');
  }

  /**
   * Subscribe to a specific table
   */
  private subscribeToTable(
    tableName: string
  ): void {
    if (!this.client) return;

    const channel = this.client
      .channel(`public:${tableName}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName
        },
        (payload) => {
          this.handleDatabaseChange(tableName, payload);
        }
      )
      .subscribe((status) => {
        logger.info({
          message: `Realtime subscription status for ${tableName}`,
          status
        });

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.handleSubscriptionError(tableName);
        }
      });

    this.channels.set(tableName, channel);
  }

  /**
   * Handle database changes and broadcast to WebSocket clients
   */
  private handleDatabaseChange(
    tableName: string,
    payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }
  ): void {
    logger.debug({
      message: 'Database change detected',
      table: tableName,
      eventType: payload.eventType
    });

    // Map table names to channel names
    const channelMap: Record<string, string> = {
      'activities': 'activities',
      'skills': 'skills',
      'system_events': 'system'
    };

    const channel = channelMap[tableName];
    if (!channel) return;

    // Broadcast to WebSocket clients
    gatewaySocket.broadcast({
      type: 'update',
      channel,
      payload: {
        event: `db_${payload.eventType.toLowerCase()}`,
        table: tableName,
        data: payload.eventType === 'DELETE' ? payload.old : payload.new,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    }, channel);
  }

  /**
   * Handle subscription errors with exponential backoff
   */
  private handleSubscriptionError(tableName: string): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error({
        message: 'Max reconnect attempts reached for Supabase realtime',
        tableName,
        attempts: this.reconnectAttempts
      });
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.warn({
      message: 'Attempting to reconnect Supabase realtime subscription',
      tableName,
      attempt: this.reconnectAttempts,
      delay
    });

    setTimeout(() => {
      this.resubscribe(tableName);
    }, delay);
  }

  /**
   * Resubscribe to a table
   */
  private resubscribe(tableName: string): void {
    const existingChannel = this.channels.get(tableName);
    if (existingChannel) {
      existingChannel.unsubscribe();
      this.channels.delete(tableName);
    }

    // Re-subscribe
    this.subscribeToTable(tableName);
  }

  /**
   * Broadcast a custom event to all subscribers
   */
  broadcast(event: {
    channel: string;
    type: string;
    payload: Record<string, unknown>;
  }): void {
    gatewaySocket.broadcast({
      type: 'update',
      channel: event.channel,
      payload: {
        event: event.type,
        ...event.payload,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    }, event.channel);
  }

  /**
   * Get subscription status
   */
  getStatus(): {
    isInitialized: boolean;
    connectedChannels: string[];
    reconnectAttempts: number;
  } {
    return {
      isInitialized: this.isInitialized,
      connectedChannels: Array.from(this.channels.keys()),
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Stop all subscriptions and cleanup
   */
  stop(): void {
    this.channels.forEach((channel, tableName) => {
      channel.unsubscribe();
      logger.info({
        message: 'Unsubscribed from realtime channel',
        tableName
      });
    });

    this.channels.clear();
    this.isInitialized = false;
    this.reconnectAttempts = 0;

    logger.info('Supabase realtime stopped');
  }
}

// Export singleton instance
export const supabaseRealtime = new SupabaseRealtimeService();
export default supabaseRealtime;
