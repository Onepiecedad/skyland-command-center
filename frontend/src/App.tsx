import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Zap, Building2, Monitor, Puzzle, Radar } from 'lucide-react';
import { SegmentedControl } from './components/SegmentedControl';
import { ParallaxBackground } from './components/ParallaxBackground';
import { StatusBar } from './components/StatusBar';
import { AgentMonitor } from './components/AgentMonitor';
import { AlexView } from './pages/AlexView';
import { CustomerView } from './pages/CustomerView';
import { SystemDashboard } from './pages/SystemDashboard';
import { SkillsView } from './pages/SkillsView';
import FleetMonitor from './pages/FleetMonitor';
import './App.css';

type View = 'alex' | 'customers' | 'system' | 'skills' | 'fleet';

interface Segment {
  key: string;
  label: string;
  icon?: ReactNode;
}

const SEGMENTS: Segment[] = [
  { key: 'alex', label: 'Alex', icon: <Zap size={14} strokeWidth={2.5} /> },
  { key: 'customers', label: 'Kunder', icon: <Building2 size={14} strokeWidth={2} /> },
  { key: 'system', label: 'System', icon: <Monitor size={14} strokeWidth={2} /> },
  { key: 'skills', label: 'Skills', icon: <Puzzle size={14} strokeWidth={2} /> },
  { key: 'fleet', label: 'Fleet', icon: <Radar size={14} strokeWidth={2} /> },
];

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

  const handleViewChange = useCallback((key: string) => {
    setCurrentView(key as View);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Keyboard shortcuts: ⌘+1 = Alex, ⌘+2 = Kunder, ⌘+3 = System
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === '1') {
        e.preventDefault();
        handleViewChange('alex');
      } else if (e.key === '2') {
        e.preventDefault();
        handleViewChange('customers');
      } else if (e.key === '3') {
        e.preventDefault();
        handleViewChange('system');
      } else if (e.key === '4') {
        e.preventDefault();
        handleViewChange('skills');
      } else if (e.key === '5') {
        e.preventDefault();
        handleViewChange('fleet');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleViewChange]);

  return (
    <>
      {/* Living parallax background behind everything */}
      <ParallaxBackground />

      <div className="dashboard-v2">
        {/* Header — Floating glass bar */}
        <header className="dashboard-v2-header">
          <h1 className="dashboard-v2-title">Skyland</h1>
          <SegmentedControl
            segments={SEGMENTS}
            activeKey={currentView}
            onSelect={handleViewChange}
          />
          <div className="dashboard-v2-shortcuts">
            <span className="shortcut-hint">⌘1</span>
            <span className="shortcut-hint">⌘2</span>
            <span className="shortcut-hint">⌘3</span>
            <span className="shortcut-hint">⌘4</span>
            <span className="shortcut-hint">⌘5</span>
          </div>
          <AgentMonitor />
        </header>

        {/* View Content — Zoom transitions */}
        <main className="dashboard-v2-main">
          <AnimatePresence mode="wait">
            {currentView === 'alex' && (
              <motion.div
                key="alex"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <AlexView onTaskCreated={handleRefresh} />
              </motion.div>
            )}
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
            {currentView === 'fleet' && (
              <motion.div
                key="fleet"
                className="view-container"
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <FleetMonitor />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Status Bar */}
        <StatusBar />
      </div>
    </>
  );
}

export default App;
