import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { LayoutGrid, Target, Workflow, Globe, Briefcase, Archive, Monitor, Puzzle, LogOut } from 'lucide-react';
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
import { IntroSequence } from './components/IntroSequence';
import { AlexDock } from './components/AlexDock';
import { GuidedTour } from './components/GuidedTour';
import { FocusNavigator, type CrossLayout } from './navigation/FocusNavigator';
import { subscribeUiActions } from './navigation/uiActions';
import { checkAuth, logout } from './api';
import './styles/index.css';

/**
 * Navigationen är ett dynamiskt KORS (Focus Navigation Engine) — inte flikar.
 * Fem vyer: en i fokus, fyra grannar. Se navigation/FocusNavigator.tsx.
 */

const DEFAULT_LAYOUT: CrossLayout = {
    center: 'alex',
    up: 'system',
    right: 'customers',
    down: 'content',
    left: 'sales',
};

const LABELS: Record<string, string> = {
    alex: 'Alex',
    sales: 'Försäljning',
    customers: 'Kunder',
    content: 'Innehåll',
    system: 'System',
};

/* ─── Panel med intern undernav (grupper med flera vyer) ─── */

interface SubView {
    key: string;
    label: string;
    icon?: ReactNode;
    render: () => ReactNode;
}

function SubViewPane({ views, storageKey }: { views: SubView[]; storageKey: string }) {
    const [active, setActive] = useState<string>(() => {
        const saved = localStorage.getItem(storageKey);
        return views.some(v => v.key === saved) ? (saved as string) : views[0].key;
    });
    useEffect(() => { localStorage.setItem(storageKey, active); }, [active, storageKey]);

    // Alex kan byta undervy via navigate_ui (t.ex. "visa sekvenserna")
    useEffect(() => {
        const onSubview = (e: Event) => {
            const sub = (e as CustomEvent<{ subview: string }>).detail?.subview;
            if (sub && views.some(v => v.key === sub)) setActive(sub);
        };
        window.addEventListener('scc:subview', onSubview);
        return () => window.removeEventListener('scc:subview', onSubview);
    }, [views]);

    return (
        <div className="pane-with-subnav">
            <div className="pane-subnav">
                <SegmentedControl
                    segments={views.map(({ key, label, icon }) => ({ key, label, icon }))}
                    activeKey={active}
                    onSelect={setActive}
                />
            </div>
            <div className="pane-subnav-content">
                {/* Alla undervyer monterade — bevarar state vid växling */}
                {views.map(v => (
                    <div key={v.key} style={{ display: v.key === active ? 'contents' : 'none' }}>
                        {v.render()}
                    </div>
                ))}
            </div>
        </div>
    );
}

function App() {
    const [centerView, setCenterView] = useState<string>('alex');

    // SCC-36: auth-gate — 'checking' tills /auth/me svarat, sen 'yes'/'no'.
    const [authState, setAuthState] = useState<'checking' | 'yes' | 'no'>('checking');
    // Cinematisk intro visas ENDAST direkt efter aktiv inloggning, inte vid session-återbesök.
    const [showIntro, setShowIntro] = useState(false);
    useEffect(() => {
        checkAuth().then((ok) => setAuthState(ok ? 'yes' : 'no'));
    }, []);

    // Alex styr UI:t (navigate_ui → SSE → CustomEvents) — chatt OCH röst
    useEffect(() => {
        if (authState !== 'yes') return;
        return subscribeUiActions();
    }, [authState]);

    const handleRefresh = useCallback(() => { /* behålls för CustomerView-kontraktet */ }, []);

    const handleLogout = useCallback(async () => {
        await logout();
        setAuthState('no');
    }, []);

    if (authState === 'checking') {
        return null;
    }
    if (authState === 'no') {
        return <LoginView onSuccess={() => { setAuthState('yes'); setShowIntro(true); }} />;
    }

    return (
        <>
            {/* Marvel-intro ovanpå — appen ligger färdig bakom när ridån lyfts */}
            {showIntro && <IntroSequence onDone={() => setShowIntro(false)} />}

            {/* Levande bakgrund bakom allt */}
            <ParallaxBackground />

            <div className="dashboard-v2">
                {/* Header — minimal: logga + fokusvyns namn + agentstatus */}
                <header className="dashboard-v2-header">
                    <h1 className="dashboard-v2-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img src="/logo.png" alt="" style={{ height: 32, width: 32, objectFit: 'cover', objectPosition: '50% 30%', mixBlendMode: 'screen', filter: 'drop-shadow(0 0 8px rgba(16,185,129,0.5)) brightness(1.2)' }} />
                        Skyland
                    </h1>
                    <span className="dashboard-v2-focus-label">{LABELS[centerView]}</span>
                    <AgentMonitor />
                    <button
                        onClick={() => void handleLogout()}
                        title="Logga ut"
                        style={{
                            marginLeft: 10, width: 30, height: 30, borderRadius: 9,
                            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
                            color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#ff8a80'; e.currentTarget.style.borderColor = 'rgba(255,138,128,0.4)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                    >
                        <LogOut size={15} />
                    </button>
                </header>

                {/* ── Korset ── */}
                <main className="dashboard-v2-main" style={{ display: 'flex', minHeight: 0 }}>
                    <FocusNavigator
                        defaultLayout={DEFAULT_LAYOUT}
                        labels={LABELS}
                        onCenterChange={setCenterView}
                        panes={{
                            alex: <AlexView />,
                            sales: (
                                <SubViewPane
                                    storageKey="scc-sub-sales"
                                    views={[
                                        { key: 'crm', label: 'CRM', icon: <LayoutGrid size={13} strokeWidth={2} />, render: () => <CrmView /> },
                                        { key: 'leads', label: 'Leads', icon: <Target size={13} strokeWidth={2} />, render: () => <LeadsView /> },
                                        { key: 'sequences', label: 'Sekvenser', icon: <Workflow size={13} strokeWidth={2} />, render: () => <SequencesView /> },
                                    ]}
                                />
                            ),
                            customers: <CustomerView onTaskCreated={handleRefresh} />,
                            content: (
                                <SubViewPane
                                    storageKey="scc-sub-content"
                                    views={[
                                        { key: 'website', label: 'Hemsida', icon: <Globe size={13} strokeWidth={2} />, render: () => <WebsiteView /> },
                                        { key: 'office', label: 'Kontor', icon: <Briefcase size={13} strokeWidth={2} />, render: () => <OfficeView /> },
                                        { key: 'archive', label: 'Arkiv', icon: <Archive size={13} strokeWidth={2} />, render: () => <ArchiveView /> },
                                    ]}
                                />
                            ),
                            system: (
                                <SubViewPane
                                    storageKey="scc-sub-system"
                                    views={[
                                        { key: 'system', label: 'Översikt', icon: <Monitor size={13} strokeWidth={2} />, render: () => <SystemDashboard /> },
                                        { key: 'skills', label: 'Skills', icon: <Puzzle size={13} strokeWidth={2} />, render: () => <SkillsView /> },
                                    ]}
                                />
                            ),
                        }}
                    />
                </main>

                {/* Status Bar */}
                <StatusBar />
            </div>

            {/* Flytande Alex — alltid tillgänglig (⌘J). Döljs när Alex-vyn är i fokus. */}
            {/* Docken (server-Alex: röst + UI-styrning) visas ÖVERALLT — Alex-vyns
                egen chat är gateway-Alex (terminalen) och saknar röst/navigate_ui. */}
            <AlexDock />
            <GuidedTour />
        </>
    );
}

export default App;
