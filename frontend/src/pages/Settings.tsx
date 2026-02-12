import { useState } from 'react';
import { 
  Settings, 
  Bell, 
  Shield, 
  Database, 
  Webhook,
  Save,
  CheckCircle2
} from 'lucide-react';

/**
 * Settings Component
 * Application settings and configuration
 */
export default function SettingsView() {
  const [activeTab, setActiveTab] = useState('general');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-8 h-8 text-gray-700" />
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        </div>
        <p className="text-gray-600">
          Configure your Skyland Command Center preferences
        </p>
      </div>

      {/* Settings Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <TabButton 
          active={activeTab === 'general'} 
          onClick={() => setActiveTab('general')}
          icon={<Settings className="w-4 h-4" />}
          label="General"
        />
        <TabButton 
          active={activeTab === 'notifications'} 
          onClick={() => setActiveTab('notifications')}
          icon={<Bell className="w-4 h-4" />}
          label="Notifications"
        />
        <TabButton 
          active={activeTab === 'security'} 
          onClick={() => setActiveTab('security')}
          icon={<Shield className="w-4 h-4" />}
          label="Security"
        />
        <TabButton 
          active={activeTab === 'integrations'} 
          onClick={() => setActiveTab('integrations')}
          icon={<Database className="w-4 h-4" />}
          label="Integrations"
        />
      </div>

      {/* Settings Content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'notifications' && <NotificationSettings />}
        {activeTab === 'security' && <SecuritySettings />}
        {activeTab === 'integrations' && <IntegrationSettings />}
      </div>

      {/* Save Button */}
      <div className="mt-6 flex items-center justify-between">
        {saved && (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="w-5 h-5" />
            <span>Settings saved successfully</span>
          </div>
        )}
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors ml-auto"
        >
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}

// Tab Button Component
function TabButton({ 
  active, 
  onClick, 
  icon, 
  label 
}: { 
  active: boolean; 
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors border-b-2 -mb-px
        ${active 
          ? 'border-blue-600 text-blue-600' 
          : 'border-transparent text-gray-600 hover:text-gray-900'
        }`}
    >
      {icon}
      {label}
    </button>
  );
}

// General Settings
function GeneralSettings() {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Application Name
        </label>
        <input
          type="text"
          defaultValue="Skyland Command Center"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Time Zone
        </label>
        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <option>UTC</option>
          <option>Europe/Stockholm</option>
          <option>America/New_York</option>
          <option>Asia/Tokyo</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Language
        </label>
        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <option>English</option>
          <option>Swedish</option>
          <option>German</option>
        </select>
      </div>

      <div className="flex items-center justify-between py-3">
        <div>
          <p className="font-medium text-gray-900">Auto-refresh Data</p>
          <p className="text-sm text-gray-500">Automatically refresh dashboard data</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" defaultChecked className="sr-only peer" />
          <div className="w-11 h-6 bg-gray-200 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
    </div>
  );
}

// Notification Settings
function NotificationSettings() {
  return (
    <div className="space-y-4">
      <h3 className="font-medium text-gray-900 mb-4">Email Notifications</h3>
      
      {[
        { label: 'New activities assigned to you', description: 'Get notified when you are assigned a new task' },
        { label: 'System alerts', description: 'Receive alerts for system issues' },
        { label: 'Weekly summary', description: 'Get a weekly summary of your activities' }
      ].map((item, index) => (
        <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
          <div>
            <p className="font-medium text-gray-900">{item.label}</p>
            <p className="text-sm text-gray-500">{item.description}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" defaultChecked={index !== 2} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      ))}
    </div>
  );
}

// Security Settings
function SecuritySettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-medium text-gray-900 mb-4">Change Password</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Current Password
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Password
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm New Password
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="font-medium text-gray-900 mb-4">Two-Factor Authentication</h3>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="font-medium text-gray-900">Enable 2FA</p>
            <p className="text-sm text-gray-500">Add an extra layer of security to your account</p>
          </div>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Setup 2FA
          </button>
        </div>
      </div>
    </div>
  );
}

// Integration Settings
function IntegrationSettings() {
  return (
    <div className="space-y-4">
      <h3 className="font-medium text-gray-900 mb-4">Connected Services</h3>
      
      {[
        { name: 'Supabase', status: 'connected', icon: <Database className="w-5 h-5" /> },
        { name: 'WebSocket Gateway', status: 'connected', icon: <Webhook className="w-5 h-5" /> }
      ].map((service, index) => (
        <div key={index} className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              {service.icon}
            </div>
            <div>
              <p className="font-medium text-gray-900">{service.name}</p>
              <p className="text-sm text-green-600">{service.status}</p>
            </div>
          </div>
          <button className="text-sm text-gray-600 hover:text-gray-900">
            Configure
          </button>
        </div>
      ))}

      <div className="pt-4">
        <h3 className="font-medium text-gray-900 mb-4">API Keys</h3>
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">API Key</span>
            <button className="text-sm text-blue-600 hover:text-blue-700">
              Regenerate
            </button>
          </div>
          <code className="block bg-gray-100 rounded px-3 py-2 text-sm text-gray-600 font-mono">
            sk_live_••••••••••••••••••••••••••••••••
          </code>
        </div>
      </div>
    </div>
  );
}
