import { useState, useCallback } from 'react';
import { CustomerList } from './components/CustomerList';
import { ActivityLog } from './components/ActivityLog';
import { PendingApprovals } from './components/PendingApprovals';
import { MasterBrainChat } from './components/MasterBrainChat';
import { Realm3D } from './components/Realm3D';
import { SystemMonitor } from './pages/SystemMonitor';
import './App.css';

type View = 'dashboard' | 'monitor';

function App() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomerSlug, setSelectedCustomerSlug] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentView, setCurrentView] = useState<View>('dashboard');

  const handleSelectCustomer = (id: string | null, slug: string | null) => {
    setSelectedCustomerId(id);
    setSelectedCustomerSlug(slug);
  };

  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🚀 Skyland Command Center</h1>
        {selectedCustomerSlug && currentView === 'dashboard' && (
          <span className="filter-badge">
            Filtering: {selectedCustomerSlug}
            <button onClick={() => handleSelectCustomer(null, null)}>×</button>
          </span>
        )}
        <div className="nav-tabs">
          <button
            className={`nav-tab ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentView('dashboard')}
          >
            📊 Dashboard
          </button>
          <button
            className={`nav-tab ${currentView === 'monitor' ? 'active' : ''}`}
            onClick={() => setCurrentView('monitor')}
          >
            🖥️ System Monitor
          </button>
        </div>
      </header>

      {currentView === 'dashboard' ? (
        <>
          {/* 3D Realm Visualization */}
          <div className="realm-row">
            <Realm3D
              selectedCustomerId={selectedCustomerId}
              onSelectCustomer={handleSelectCustomer}
            />
          </div>

          <div className="dashboard-grid">
            <div className="left-column">
              <CustomerList
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={handleSelectCustomer}
              />
              <PendingApprovals
                key={`approvals-${refreshKey}`}
                selectedCustomerId={selectedCustomerId}
                onApproved={handleRefresh}
              />
            </div>

            <div className="right-column">
              <ActivityLog
                key={`activity-${refreshKey}`}
                selectedCustomerId={selectedCustomerId}
              />
              <MasterBrainChat
                onTaskCreated={handleRefresh}
              />
            </div>
          </div>
        </>
      ) : (
        <SystemMonitor />
      )}
    </div>
  );
}

export default App;
