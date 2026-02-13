import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

/**
 * Supabase Realtime Service
 * Manages real-time subscriptions for live data updates
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

class RealtimeService {
  private client: SupabaseClient | null = null;
  private channels: Map<string, RealtimeChannel> = new Map();
  private listeners: Map<string, Set<(payload: unknown) => void>> = new Map();

  /**
   * Initialize Supabase client
   */
  initialize(): boolean {
    if (this.client) return true;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('Supabase credentials not found, realtime features disabled');
      return false;
    }

    try {
      this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });

      console.log('Supabase realtime initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Supabase:', error);
      return false;
    }
  }

  /**
   * Subscribe to a channel for real-time updates
   */
  subscribe(
    channelName: string,
    table: string,
    callback: (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => void
  ): () => void {
    if (!this.client) {
      if (!this.initialize()) {
        return () => { }; // Return no-op cleanup function
      }
    }

    // Create channel if not exists
    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = this.client!.channel(channelName);
      this.channels.set(channelName, channel);
    }

    // Subscribe to database changes
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: table
        },
        (payload) => {
          callback(payload as {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new: Record<string, unknown>;
            old: Record<string, unknown>;
          });
        }
      )
      .subscribe((status) => {
        console.log(`Realtime subscription status for ${channelName}:`, status);
        // Auto-reconnect on channel error or timeout
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[Realtime] ${channelName} ${status}, will re-subscribe in 5s`);
          // Remove broken channel so a fresh one is created on next subscribe
          const broken = this.channels.get(channelName);
          if (broken) {
            broken.unsubscribe();
            this.channels.delete(channelName);
          }
          // Re-subscribe after delay for all existing listeners
          setTimeout(() => {
            const listeners = this.listeners.get(channelName);
            if (listeners && listeners.size > 0) {
              const firstListener = listeners.values().next().value;
              if (firstListener) {
                this.subscribe(channelName, table, firstListener as typeof callback);
              }
            }
          }, 5000);
        }
      });

    // Store listener
    if (!this.listeners.has(channelName)) {
      this.listeners.set(channelName, new Set());
    }
    this.listeners.get(channelName)!.add(callback as (payload: unknown) => void);

    // Return unsubscribe function
    return () => {
      this.unsubscribe(channelName, callback as (payload: unknown) => void);
    };
  }

  /**
   * Unsubscribe from a channel
   */
  private unsubscribe(channelName: string, callback: (payload: unknown) => void): void {
    const channelListeners = this.listeners.get(channelName);
    if (channelListeners) {
      channelListeners.delete(callback as (payload: unknown) => void);

      // If no more listeners, remove the channel
      if (channelListeners.size === 0) {
        const channel = this.channels.get(channelName);
        if (channel) {
          channel.unsubscribe();
          this.channels.delete(channelName);
        }
        this.listeners.delete(channelName);
      }
    }
  }

  /**
   * Subscribe to activities updates
   */
  subscribeToActivities(
    callback: (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      data: Record<string, unknown>;
    }) => void
  ): () => void {
    return this.subscribe('activities', 'activities', (payload) => {
      callback({
        eventType: payload.eventType,
        data: payload.eventType === 'DELETE' ? payload.old : payload.new
      });
    });
  }

  /**
   * Subscribe to skills updates
   */
  subscribeToSkills(
    callback: (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      data: Record<string, unknown>;
    }) => void
  ): () => void {
    return this.subscribe('skills', 'skills', (payload) => {
      callback({
        eventType: payload.eventType,
        data: payload.eventType === 'DELETE' ? payload.old : payload.new
      });
    });
  }

  /**
   * Get client instance
   */
  getClient(): SupabaseClient | null {
    return this.client;
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    this.channels.forEach((channel) => {
      channel.unsubscribe();
    });
    this.channels.clear();
    this.listeners.clear();
  }
}

// Export singleton instance
export const realtimeService = new RealtimeService();
export default realtimeService;
