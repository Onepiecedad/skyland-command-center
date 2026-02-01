import { useState, useCallback } from 'react';
import { CustomerList } from './components/CustomerList';
import { ActivityLog } from './components/ActivityLog';
import { PendingApprovals } from './components/PendingApprovals';
import { MasterBrainChat } from './components/MasterBrainChat';
import './App.css';

function App() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomerSlug, setSelectedCustomerSlug] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
        {selectedCustomerSlug && (
          <span className="filter-badge">
            Filtering: {selectedCustomerSlug}
            <button onClick={() => handleSelectCustomer(null, null)}>×</button>
          </span>
        )}
      </header>

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
    </div>
  );
}

export default App;
