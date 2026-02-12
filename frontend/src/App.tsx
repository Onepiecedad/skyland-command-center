import { Suspense, lazy } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Brain, 
  Archive, 
  Settings, 
  Activity,
  Menu,
  X
} from 'lucide-react';
import { useState } from 'react';
import { PageLoading } from '@components/Loading';
import { ErrorBoundary, RouteErrorBoundary } from '@components/ErrorBoundary';

// Lazy load page components for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AlexView = lazy(() => import('./pages/AlexView'));
const ArchiveView = lazy(() => import('./pages/ArchiveView'));
const SettingsView = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

/**
 * App Component with Lazy Loading
 * Implements Suspense boundaries for all routes
 */
function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Sidebar */}
      <aside 
        className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 transition-all duration-300 z-40 
          ${sidebarOpen ? 'w-64' : 'w-20'}`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
          <div className={`flex items-center gap-3 ${!sidebarOpen && 'justify-center w-full'}`}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            {sidebarOpen && (
              <span className="font-bold text-gray-900">Skyland CC</span>
            )}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="p-4 space-y-2">
          <NavItem 
            to="/" 
            icon={<LayoutDashboard className="w-5 h-5" />} 
            label="Dashboard"
            collapsed={!sidebarOpen}
          />
          <NavItem 
            to="/skills" 
            icon={<Brain className="w-5 h-5" />} 
            label="Knowledge"
            collapsed={!sidebarOpen}
          />
          <NavItem 
            to="/activities" 
            icon={<Archive className="w-5 h-5" />} 
            label="Activities"
            collapsed={!sidebarOpen}
          />
          <NavItem 
            to="/logs" 
            icon={<Activity className="w-5 h-5" />} 
            label="System Logs"
            collapsed={!sidebarOpen}
          />
          <NavItem 
            to="/settings" 
            icon={<Settings className="w-5 h-5" />} 
            label="Settings"
            collapsed={!sidebarOpen}
          />
        </nav>
      </aside>

      {/* Main Content */}
      <main 
        className={`transition-all duration-300 min-h-screen
          ${sidebarOpen ? 'ml-64' : 'ml-20'}`}
      >
        {/* Error Boundary wraps all routes */}
        <ErrorBoundary>
          <Routes>
            <Route 
              path="/" 
              element={
                <RouteErrorBoundary>
                  <Suspense fallback={<PageLoading />}>
                    <Dashboard />
                  </Suspense>
                </RouteErrorBoundary>
              } 
            />
            <Route 
              path="/skills" 
              element={
                <RouteErrorBoundary>
                  <Suspense fallback={<PageLoading />}>
                    <AlexView />
                  </Suspense>
                </RouteErrorBoundary>
              } 
            />
            <Route 
              path="/activities" 
              element={
                <RouteErrorBoundary>
                  <Suspense fallback={<PageLoading />}>
                    <ArchiveView />
                  </Suspense>
                </RouteErrorBoundary>
              } 
            />
            <Route 
              path="/logs" 
              element={
                <RouteErrorBoundary>
                  <Suspense fallback={<PageLoading />}>
                    <SystemLogsView />
                  </Suspense>
                </RouteErrorBoundary>
              } 
            />
            <Route 
              path="/settings" 
              element={
                <RouteErrorBoundary>
                  <Suspense fallback={<PageLoading />}>
                    <SettingsView />
                  </Suspense>
                </RouteErrorBoundary>
              } 
            />
            <Route 
              path="*" 
              element={
                <Suspense fallback={<PageLoading />}>
                  <NotFound />
                </Suspense>
              } 
            />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

// Navigation Item Component
function NavItem({ 
  to, 
  icon, 
  label, 
  collapsed 
}: { 
  to: string; 
  icon: React.ReactNode; 
  label: string;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `
        flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
        ${isActive 
          ? 'bg-blue-50 text-blue-600' 
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }
        ${collapsed && 'justify-center'}
      `}
    >
      {icon}
      {!collapsed && <span className="font-medium">{label}</span>}
    </NavLink>
  );
}

// Placeholder components for lazy-loaded routes
function SystemLogsView() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">System Logs</h1>
      <p className="text-gray-600">System logs and monitoring interface coming soon...</p>
    </div>
  );
}

export default App;
