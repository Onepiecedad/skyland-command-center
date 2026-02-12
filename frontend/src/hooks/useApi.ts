import { useQuery, useMutation, useQueryClient, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import apiClient from '@/api/axiosConfig';
import { queryKeys } from '@/utils/queryClient';

// Types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  requestId: string;
  timestamp: string;
}

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

// Skills API Hooks

/**
 * Hook to fetch all skills
 */
export function useSkills(options?: UseQueryOptions<Skill[]>) {
  return useQuery<Skill[]>({
    queryKey: queryKeys.skills.lists(),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Skill[]>>('/skills');
      return response.data.data;
    },
    ...options
  });
}

/**
 * Hook to fetch a single skill by ID
 */
export function useSkill(id: string, options?: UseQueryOptions<Skill>) {
  return useQuery<Skill>({
    queryKey: queryKeys.skills.detail(id),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Skill>>(`/skills/${id}`);
      return response.data.data;
    },
    enabled: !!id, // Only run if id is provided
    ...options
  });
}

/**
 * Hook to create a new skill
 */
export function useCreateSkill(options?: UseMutationOptions<Skill, Error, CreateSkillRequest>) {
  const queryClient = useQueryClient();

  return useMutation<Skill, Error, CreateSkillRequest>({
    mutationFn: async (data) => {
      const response = await apiClient.post<ApiResponse<Skill>>('/skills', data);
      return response.data.data;
    },
    onSuccess: () => {
      // Invalidate skills list to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.lists() });
    },
    ...options
  });
}

/**
 * Hook to update a skill
 */
export function useUpdateSkill(options?: UseMutationOptions<Skill, Error, { id: string; data: Partial<CreateSkillRequest> }>) {
  const queryClient = useQueryClient();

  return useMutation<Skill, Error, { id: string; data: Partial<CreateSkillRequest> }>({
    mutationFn: async ({ id, data }) => {
      const response = await apiClient.put<ApiResponse<Skill>>(`/skills/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      // Invalidate specific skill and list
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.lists() });
    },
    ...options
  });
}

/**
 * Hook to delete a skill
 */
export function useDeleteSkill(options?: UseMutationOptions<void, Error, string>) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiClient.delete<ApiResponse<void>>(`/skills/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.lists() });
    },
    ...options
  });
}

// Activities API Hooks

/**
 * Hook to fetch all activities
 */
export function useActivities(filters?: { status?: string; type?: string; priority?: string }, options?: UseQueryOptions<Activity[]>) {
  return useQuery<Activity[]>({
    queryKey: queryKeys.activities.lists(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.type) params.append('type', filters.type);
      if (filters?.priority) params.append('priority', filters.priority);

      const response = await apiClient.get<ApiResponse<Activity[]>>(`/activities?${params}`);
      return response.data.data;
    },
    ...options
  });
}

/**
 * Hook to fetch a single activity by ID
 */
export function useActivity(id: string, options?: UseQueryOptions<Activity>) {
  return useQuery<Activity>({
    queryKey: queryKeys.activities.detail(id),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Activity>>(`/activities/${id}`);
      return response.data.data;
    },
    enabled: !!id,
    ...options
  });
}

/**
 * Hook to create a new activity
 */
export function useCreateActivity(options?: UseMutationOptions<Activity, Error, CreateActivityRequest>) {
  const queryClient = useQueryClient();

  return useMutation<Activity, Error, CreateActivityRequest>({
    mutationFn: async (data) => {
      const response = await apiClient.post<ApiResponse<Activity>>('/activities', data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.lists() });
    },
    ...options
  });
}

/**
 * Hook to update an activity status
 */
export function useUpdateActivityStatus(options?: UseMutationOptions<Activity, Error, { id: string; status: Activity['status'] }>) {
  const queryClient = useQueryClient();

  return useMutation<Activity, Error, { id: string; status: Activity['status'] }>({
    mutationFn: async ({ id, status }) => {
      const response = await apiClient.patch<ApiResponse<Activity>>(`/activities/${id}/status`, { status });
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.lists() });
    },
    ...options
  });
}

/**
 * Hook to delete an activity
 */
export function useDeleteActivity(options?: UseMutationOptions<void, Error, string>) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiClient.delete<ApiResponse<void>>(`/activities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.lists() });
    },
    ...options
  });
}

// Health Check Hook
export interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
  memory?: {
    used: number;
    total: number;
  };
  services: {
    websocket: {
      status: string;
      connections: number;
    };
  };
}

/**
 * Hook to check API health status
 */
export function useHealthStatus(options?: UseQueryOptions<HealthStatus>) {
  return useQuery<HealthStatus>({
    queryKey: queryKeys.health,
    queryFn: async () => {
      const response = await apiClient.get<HealthStatus>('/health');
      return response.data;
    },
    // Poll every 30 seconds
    refetchInterval: 30000,
    // Don't fail on error
    retry: false,
    ...options
  });
}

export default useHealthStatus;
