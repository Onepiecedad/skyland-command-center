import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Zap, Building2, Monitor, Puzzle, Briefcase, Archive, Target, Globe, LayoutGrid, Workflow } from 'lucide-react';
import { SegmentedControl } from './components/SegmentedControl';
import { ParallaxBackground } from './components/ParallaxBackground';
import { StatusBar } from './components/StatusBar';
import { AgentMonitor } from './components/AgentMonitor';
import AlexView from './pages/AlexView';
import { CustomerView } from './pages/CustomerView';
import { SystemDashboard } from './pages/SystemDashboard';
import { SkillsView } from './pages/SkillsView';
import OfficeView from './pages/OfficeView';
import ArchiveView from './pages/ArchiveView';
import LeadsView from './pages/LeadsView';
import CrmView from './pages/CrmView';
import SequencesView from './pages/SequencesView';
import WebsiteView from './pages/WebsiteView';
import { LoginView } from './components/LoginView';
import { AlexDock } from './components/AlexDock';
import { checkAuth } from './api';
import './styles/index.css';

type View = 'alex' | 'customers' | 'leads' | 'crm' | 'sequences' | 'website' | 'system' | 'skills' | 'voicechat' | 'office' | 'archive';
type GroupKey = 'alex' | 'sales' | 'customers' | 'content' | 'system';

interface Segment {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface NavGroup {
  key: GroupKey;
  label: string;
  icon?: ReactNode;
  /** Vyer i gruppen — första är default. En enda vy = ingen undermeny. */
  views: Segment[];
}

/** 5 grupper istället för 11 flikar. Röstchatten bor numera i Alex-docken. */
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'alex', label: 'Alex', icon: <Zap size={14} strokeWidth={2.5} />,
    views: [{ key: 'alex', label: 'Alex' }],
  },
  {
    key: 'sales', label: 'Försäljning', icon: <Target size={14} strokeWidth={2} />,
    views: [
      { key: 'crm', label: 'CRM', icon: <LayoutGrid size={13} strokeWidth={2} /> },
      { key: 'leads', label: 'Leads', icon: <Target size={13} strokeWidth={2} /> },
      { key: 'sequences', label: 'Sekvenser', icon: <Workflow size={13} strokeWidth={2} /> },
    ],
  },
  {
    key: 'customers', label: 'Kunder', icon: <Building2 size={14} strokeWidth={2} />,
    views: [{ key: 'customers', label: 'Kunder' }],
  },
  {
    key: 'content', label: 'Innehåll', icon: <Globe size={14} strokeWidth={2} />,
    views: [
      { key: 'website', label: 'Hemsida', icon: <Globe size={13} strokeWidth={2} /> },
      { key: 'office', label: 'Kontor', icon: <Briefcase size={13} strokeWidth={2} /> },
      { key: 'archive', label: 'Arkiv', icon: <Archive size={13} strokeWidth={2} /> },
    ],
  },
  {
    key: 'system', label: 'System', icon: <Monitor size={14} strokeWidth={2} />,
    views: [
      { key: 'system', label: 'Översikt', icon: <Monitor size={13} strokeWidth={2} /> },
      { key: 'skills', label: 'Skills', icon: <Puzzle size={13} strokeWidth={2} /> },
    ],
  },
];

const groupOfView = (view: View): NavGroup =>
  NAV_GROUPS.find(g => g.views.some(v => v.key === view)) ?? NAV_GROUPS[0];

/* Zoom + fade transition for alien control panel feel */
const VIEW_VARIANTS = {
  initial: {
    scale: 0.96,
    opacity: 0,
    filter: 'blur(6px)',
  },
  animate: {
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.4,
      ease: 'easeOut' as const,
    },
  },
  exit: {
    scale: 1.03,
    opacity: 0,
    filter: 'blur(4px)',
    transition: {
      duration: 0.25,
      ease: 'easeInOut' as const,
    },
  },
};

function App() {
  const [currentView, setCurrentView] = useState<View>('alex');
  const [refreshKey, setRefreshKey] = useState(0);

  // SCC-36: auth-gate — 'checking' tills /auth/me svarat, sen 'yes'/'no'.
  const [authState, setAuthState] = useState<'checking' | 'yes' | 'no'>('checking');
  useEffect(() => {
    checkAuth().then((ok) => setAuthState(ok ? 'yes' : 'no'));
  }, []);

  // Kom ihåg senast besökta vy per grupp så gruppbyte känns förutsägbart.
  const [lastViewInGroup, setLastViewInGroup] = useState<Partial<Record<GroupKey, View>>>({});

  const handleViewChange = useCallback((key: string) => {
    const view = key as View;
    setCurrentView(view);
    setLastViewInGroup(prev => ({ ...prev, [groupOfView(view).key]: view }));
  }, []);

  const handleGroupChange = useCallback((key: string) => {
    const group = NAV_GROUPS.find(g => g.key === key) ?? NAV_GROUPS[0];
    handleViewChange(lastViewInGroup[group.key] ?? group.views[0].key);
  }, [handleViewChange, lastViewInGroup]);

  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Keyboard shortcuts: ⌘1–⌘5 = grupperna i ordning
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < NAV_GROUPS.length) {
        e.preventDefault();
        handleGroupChange(NAV_GROUPS[idx].key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleGroupChange]);

  const activeGroup = groupOfView(currentView);

  // SCC-36: auth-gate före allt annat
  if (authState === 'checking') {
    return null;
  }
  if (authState === 'no') {
    return <LoginView onSuccess={() => setAuthState('yes')} />;
  }

  return (
    <>
      {/* Living parallax background behind everything */}
      <ParallaxBackground />

      <div className="dashboard-v2">
        {/* Header — Floating glass bar */}
        <header className="dashboard-v2-header">
          <h1 className="dashboard-v2-title">Skyland</h1>
          <SegmentedControl
            segments={NAV_GROUPS.map(({ key, label, icon }) => ({ key, label, icon }))}
            activeKey={activeGroup.key}
            onSelect={handleGroupChange}
          />
          <AgentMonitor />
        </header>

        {/* Undermeny — bara när gruppen har flera vyer */}
        {activeGroup.views.length > 1 && (
          <div className="dashboard-v2-subnav">
            <SegmentedControl
              segments={activeGroup.views}
              activeKey={currentView}
              onSelect={handleViewChange}
            />
          </div>
        )}

        {/* View Content — Zoom transitions */}
        <main className="dashboard-v2-main">
          {/* AlexView stays mounted (hidden) to preserve WebSocket connection */}
          <div style={{ display: currentView === 'alex' ? 'contents' : 'none' }}>
            <AlexView />
          </div>

          <AnimatePresence mode="wait">
            {currentView === 'customers' && (
              <motion.div
                key="customers"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <CustomerView
                  key={`cv-${refreshKey}`}
                  onTaskCreated={handleRefresh}
                />
              </motion.div>
            )}
            {currentView === 'system' && (
              <motion.div
                key="system"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <SystemDashboard />
              </motion.div>
            )}
            {currentView === 'skills' && (
              <motion.div
                key="skills"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <SkillsView />
              </motion.div>
            )}
            {currentView === 'office' && (
              <motion.div
                key="office"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <OfficeView />
              </motion.div>
            )}
            {currentView === 'archive' && (
              <motion.div
                key="archive"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <ArchiveView />
              </motion.div>
            )}
            {currentView === 'leads' && (
              <motion.div
                key="leads"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <LeadsView />
              </motion.div>
            )}
            {currentView === 'crm' && (
              <motion.div
                key="crm"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <CrmView />
              </motion.div>
            )}
            {currentView === 'sequences' && (
              <motion.div
                key="sequences"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <SequencesView />
              </motion.div>
            )}
            {currentView === 'website' && (
              <motion.div
                key="website"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <WebsiteView />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Status Bar */}
        <StatusBar />
      </div>

      {/* Flytande Alex — alltid tillgänglig, oavsett vy (⌘J). Döljs på Alex-vyn som har egen chat. */}
      <AlexDock hidden={currentView === 'alex'} />
    </>
  );
}

export default App;
