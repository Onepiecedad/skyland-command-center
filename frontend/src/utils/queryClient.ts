import { QueryClient } from '@tanstack/react-query';

/**
 * React Query Client Configuration
 * Global state management with intelligent caching
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: Data stays fresh for 5 minutes
      staleTime: 1000 * 60 * 5,
      // Cache time: Keep data in cache for 10 minutes after last use
      gcTime: 1000 * 60 * 10,
      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Refetch on window focus (good for data freshness)
      refetchOnWindowFocus: true,
      // Refetch when reconnecting (good for offline scenarios)
      refetchOnReconnect: true,
      // Don't refetch on mount if data is fresh
      refetchOnMount: 'always'
    },
    mutations: {
      // Retry failed mutations once
      retry: 1,
      retryDelay: 1000
    }
  }
});

// Query keys for consistent cache management
export const queryKeys = {
  skills: {
    all: ['skills'] as const,
    lists: (filters?: Record<string, unknown>) => [...queryKeys.skills.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.skills.all, 'detail', id] as const
  },
  activities: {
    all: ['activities'] as const,
    lists: (filters?: Record<string, unknown>) => [...queryKeys.activities.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.activities.all, 'detail', id] as const
  },
  health: ['health'] as const,
  stats: ['stats'] as const
};

export default queryClient;
