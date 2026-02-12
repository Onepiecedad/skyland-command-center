import { useEffect, useState } from 'react';
import { 
  Archive, 
  Plus, 
  CheckCircle2, 
  Clock,
  XCircle,
  Circle,
  Calendar,
  Search,
  ArrowUpDown,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { 
  useActivities, 
  useCreateActivity, 
  useUpdateActivityStatus, 
  useDeleteActivity,
  Activity 
} from '@/hooks/useApi';
import { SkeletonLoading } from '@/components/Loading';
import { realtimeService } from '@/services/realtime';
import { queryClient, queryKeys } from '@/utils/queryClient';

/**
 * ArchiveView Component
 * Activity/Task management interface with React Query
 */
export default function ArchiveView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Activity['status'] | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<Activity['type'] | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Activity['priority'] | 'all'>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority'>('createdAt');
  const [isCreating, setIsCreating] = useState(false);

  // React Query hooks for data fetching
  const { 
    data: activities = [], 
    isLoading, 
    isError, 
    error,
    refetch 
  } = useActivities({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
    priority: priorityFilter !== 'all' ? priorityFilter : undefined
  });

  // Mutations
  const createActivityMutation = useCreateActivity({
    onSuccess: () => {
      setIsCreating(false);
    }
  });

  const updateStatusMutation = useUpdateActivityStatus();
  const deleteActivityMutation = useDeleteActivity();

  // Subscribe to realtime updates
  useEffect(() => {
    const unsubscribe = realtimeService.subscribeToActivities((payload) => {
      console.log('Realtime activity update:', payload);
      
      // Show notification based on event type
      if (payload.eventType === 'INSERT') {
        // Could show toast notification here
        console.log('New activity created');
      } else if (payload.eventType === 'UPDATE') {
        console.log('Activity updated');
      } else if (payload.eventType === 'DELETE') {
        console.log('Activity deleted');
      }

      // Invalidate activities query to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.lists() });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Filter and sort activities
  const filteredActivities = activities
    .filter(activity => {
      const matchesSearch = activity.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           activity.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'priority') {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  // Status statistics
  const stats = {
    total: activities.length,
    pending: activities.filter(a => a.status === 'pending').length,
    inProgress: activities.filter(a => a.status === 'in_progress').length,
    completed: activities.filter(a => a.status === 'completed').length,
    failed: activities.filter(a => a.status === 'failed').length
  };

  // Handle status change
  const handleStatusChange = (activityId: string, newStatus: Activity['status']) => {
    updateStatusMutation.mutate({ id: activityId, status: newStatus });
  };

  // Handle activity deletion
  const handleDeleteActivity = (activityId: string) => {
    if (window.confirm('Are you sure you want to delete this activity?')) {
      deleteActivityMutation.mutate(activityId);
    }
  };

  // Handle activity creation
  const handleCreateActivity = (activityData: {
    type: Activity['type'];
    title: string;
    description: string;
    priority: Activity['priority'];
  }) => {
    createActivityMutation.mutate(activityData);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <SkeletonLoading count={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600 mb-4">
            Error loading activities: {error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Archive className="w-8 h-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Activity Archive</h1>
        </div>
        <p className="text-gray-600">
          Track and manage tasks, events, and system activities
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard 
          label="Total" 
          value={stats.total} 
          color="gray" 
          icon={<Circle className="w-4 h-4" />} 
        />
        <StatCard 
          label="Pending" 
          value={stats.pending} 
          color="yellow" 
          icon={<Clock className="w-4 h-4" />} 
        />
        <StatCard 
          label="In Progress" 
          value={stats.inProgress} 
          color="blue" 
          icon={<RefreshCw className="w-4 h-4" />} 
        />
        <StatCard 
          label="Completed" 
          value={stats.completed} 
          color="green" 
          icon={<CheckCircle2 className="w-4 h-4" />} 
        />
        <StatCard 
          label="Failed" 
          value={stats.failed} 
          color="red" 
          icon={<XCircle className="w-4 h-4" />} 
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search activities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as Activity['status'] | 'all')}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        {/* Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as Activity['type'] | 'all')}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        >
          <option value="all">All Types</option>
          <option value="task">Task</option>
          <option value="event">Event</option>
          <option value="system">System</option>
        </select>

        {/* Priority Filter */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Activity['priority'] | 'all')}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        >
          <option value="all">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {/* Sort */}
        <button
          onClick={() => setSortBy(sortBy === 'createdAt' ? 'priority' : 'createdAt')}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowUpDown className="w-4 h-4" />
          Sort by {sortBy === 'createdAt' ? 'Date' : 'Priority'}
        </button>

        {/* Add Button */}
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Activity
        </button>
      </div>

      {/* Activities List */}
      <div className="space-y-4">
        {filteredActivities.map(activity => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            onStatusChange={(status) => handleStatusChange(activity.id, status)}
            onDelete={() => handleDeleteActivity(activity.id)}
            isUpdating={updateStatusMutation.isPending}
          />
        ))}
      </div>

      {/* Create Modal */}
      {isCreating && (
        <CreateActivityModal
          onClose={() => setIsCreating(false)}
          onCreate={handleCreateActivity}
          isLoading={createActivityMutation.isPending}
        />
      )}

      {/* Empty State */}
      {filteredActivities.length === 0 && !isLoading && (
        <div className="text-center py-16">
          <Archive className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No activities found</h3>
          <p className="text-gray-500 mb-4">
            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Get started by creating your first activity'}
          </p>
          {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTypeFilter('all');
                setPriorityFilter('all');
              }}
              className="text-purple-600 hover:text-purple-700"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Stat Card Component
function StatCard({ 
  label, 
  value, 
  color, 
  icon 
}: { 
  label: string; 
  value: number; 
  color: 'gray' | 'yellow' | 'blue' | 'green' | 'red';
  icon: React.ReactNode;
}) {
  const colorClasses = {
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700'
  };

  return (
    <div className={`border rounded-lg p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

// Activity Card Component
function ActivityCard({ 
  activity, 
  onStatusChange, 
  onDelete,
  isUpdating 
}: { 
  activity: Activity;
  onStatusChange: (status: Activity['status']) => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const statusConfig = {
    pending: { icon: <Clock className="w-5 h-5" />, color: 'text-yellow-600 bg-yellow-50', label: 'Pending' },
    in_progress: { icon: <RefreshCw className="w-5 h-5" />, color: 'text-blue-600 bg-blue-50', label: 'In Progress' },
    completed: { icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-green-600 bg-green-50', label: 'Completed' },
    failed: { icon: <XCircle className="w-5 h-5" />, color: 'text-red-600 bg-red-50', label: 'Failed' }
  };

  const priorityConfig = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700'
  };

  const typeConfig = {
    task: 'bg-blue-100 text-blue-700',
    event: 'bg-purple-100 text-purple-700',
    system: 'bg-gray-100 text-gray-700'
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 rounded text-xs font-medium ${typeConfig[activity.type]}`}>
            {activity.type}
          </span>
          <span className={`px-2 py-1 rounded text-xs font-medium ${priorityConfig[activity.priority]}`}>
            {activity.priority}
          </span>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded ${statusConfig[activity.status].color}`}>
          {statusConfig[activity.status].icon}
          <span className="text-sm font-medium">{statusConfig[activity.status].label}</span>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">{activity.title}</h3>
      <p className="text-gray-600 mb-4">{activity.description}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {new Date(activity.createdAt).toLocaleDateString()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activity.status !== 'completed' && activity.status !== 'failed' && (
            <>
              {activity.status === 'pending' && (
                <button
                  onClick={() => onStatusChange('in_progress')}
                  disabled={isUpdating}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Start
                </button>
              )}
              {activity.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => onStatusChange('completed')}
                    disabled={isUpdating}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => onStatusChange('failed')}
                    disabled={isUpdating}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    Fail
                  </button>
                </>
              )}
            </>
          )}
          <button
            onClick={onDelete}
            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Create Activity Modal
function CreateActivityModal({ 
  onClose, 
  onCreate, 
  isLoading 
}: { 
  onClose: () => void; 
  onCreate: (data: {
    type: Activity['type'];
    title: string;
    description: string;
    priority: Activity['priority'];
  }) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    type: 'task' as Activity['type'],
    title: '',
    description: '',
    priority: 'medium' as Activity['priority']
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">New Activity</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as Activity['type'] })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="task">Task</option>
              <option value="event">Event</option>
              <option value="system">System</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              required
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: e.target.value as Activity['priority'] })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
