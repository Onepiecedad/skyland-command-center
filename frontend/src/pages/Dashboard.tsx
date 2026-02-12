import {
  Activity,
  CheckCircle2,
  Clock,
  AlertCircle,
  Users,
  Zap,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { useSkills, useActivities, useHealthStatus } from '@/hooks/useApi';
import { Loading } from '@components/Loading';

/**
 * Dashboard Component
 * Main overview page with key metrics
 */
export default function Dashboard() {
  const { data: skills = [], isLoading: skillsLoading } = useSkills();
  const { data: activities = [], isLoading: activitiesLoading } = useActivities();
  const { data: health, isLoading: healthLoading } = useHealthStatus();

  const isLoading = skillsLoading || activitiesLoading || healthLoading;

  if (isLoading) {
    return (
      <div className="p-6">
        <Loading size="lg" text="Loading dashboard..." />
      </div>
    );
  }

  // Calculate metrics
  const totalSkills = skills.length;
  const activeSkills = skills.filter(s => s.active).length;
  const totalActivities = activities.length;
  const pendingActivities = activities.filter(a => a.status === 'pending').length;
  const completedActivities = activities.filter(a => a.status === 'completed').length;
  const wsConnections = health?.services?.websocket?.connections || 0;

  // Recent activities (last 5)
  const recentActivities = [...activities]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-600">Overview of your Skyland Command Center</p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <MetricCard
          title="Total Skills"
          value={totalSkills}
          subtitle={`${activeSkills} active`}
          icon={<Zap className="w-6 h-6 text-yellow-500" />}
          trend={{ value: 12, positive: true }}
        />
        <MetricCard
          title="Activities"
          value={totalActivities}
          subtitle={`${pendingActivities} pending`}
          icon={<Activity className="w-6 h-6 text-blue-500" />}
          trend={{ value: 5, positive: true }}
        />
        <MetricCard
          title="Completed"
          value={completedActivities}
          subtitle={`${Math.round((completedActivities / totalActivities) * 100) || 0}% completion`}
          icon={<CheckCircle2 className="w-6 h-6 text-green-500" />}
          trend={{ value: 8, positive: true }}
        />
        <MetricCard
          title="WebSocket Connections"
          value={wsConnections}
          subtitle="Active connections"
          icon={<Users className="w-6 h-6 text-purple-500" />}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activities */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Activities</h2>
            <a href="/activities" className="text-sm text-blue-600 hover:text-blue-700">
              View all
            </a>
          </div>

          <div className="space-y-4">
            {recentActivities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <StatusIcon status={activity.status} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{activity.title}</p>
                  <p className="text-sm text-gray-500">{activity.type}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(activity.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}

            {recentActivities.length === 0 && (
              <p className="text-center text-gray-500 py-4">No recent activities</p>
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
            <span className={`px-2 py-1 rounded text-xs font-medium ${health?.status === 'healthy'
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
              }`}>
              {health?.status || 'Unknown'}
            </span>
          </div>

          <div className="space-y-4">
            <HealthItem
              label="WebSocket Service"
              status={health?.services?.websocket?.status === 'up' ? 'up' : 'down'}
              details={`${wsConnections} connections`}
            />
            <HealthItem
              label="API Server"
              status="up"
              details={`Version ${health?.version || '1.0.0'}`}
            />
            <HealthItem
              label="Uptime"
              status="up"
              details={`${Math.floor((health?.uptime || 0) / 3600)} hours`}
            />
          </div>

          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Memory Usage</span>
              <span className="font-medium text-gray-900">
                {health?.memory?.used || 0} / {health?.memory?.total || 0} MB
              </span>
            </div>
            <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{
                  width: `${((health?.memory?.used || 0) / (health?.memory?.total || 1)) * 100}%`
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          {icon}
        </div>
      </div>

      {trend && (
        <div className={`flex items-center gap-1 mt-4 text-sm ${trend.positive ? 'text-green-600' : 'text-red-600'
          }`}>
          {trend.positive ? (
            <ArrowUpRight className="w-4 h-4" />
          ) : (
            <ArrowDownRight className="w-4 h-4" />
          )}
          <span>{trend.value}% from last week</span>
        </div>
      )}
    </div>
  );
}

// Status Icon Component
function StatusIcon({ status }: { status: string }) {
  const icons = {
    pending: <Clock className="w-5 h-5 text-yellow-500" />,
    in_progress: <Activity className="w-5 h-5 text-blue-500" />,
    completed: <CheckCircle2 className="w-5 h-5 text-green-500" />,
    failed: <AlertCircle className="w-5 h-5 text-red-500" />
  };

  return icons[status as keyof typeof icons] || icons.pending;
}

// Health Item Component
function HealthItem({
  label,
  status,
  details
}: {
  label: string;
  status: 'up' | 'down';
  details: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${status === 'up' ? 'bg-green-500' : 'bg-red-500'
          }`} />
        <span className="text-gray-700">{label}</span>
      </div>
      <span className="text-sm text-gray-500">{details}</span>
    </div>
  );
}
