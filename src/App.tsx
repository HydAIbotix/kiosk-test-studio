import { useState } from 'react';
import Layout from './components/Layout';
import Dashboard    from './pages/Dashboard';
import AppExplorer  from './pages/AppExplorer';
import AppMapPage   from './pages/AppMap';
import TestIntake   from './pages/TestIntake';
import Configuration from './pages/Configuration';
import RobotSetup    from './pages/RobotSetup';
import CameraVisionTest from './pages/CameraVisionTest';
import Execution    from './pages/Execution';
import LiveMonitor  from './pages/LiveMonitor';
import Results      from './pages/Results';
import AutoRepair   from './pages/AutoRepair';
import AgenticView  from './pages/AgenticView';

type Page =
  | 'dashboard' | 'agentic-view' | 'explorer' | 'app-map' | 'test-intake'
  | 'configuration' | 'robot-setup' | 'camera-test' | 'execution' | 'monitor' | 'results' | 'auto-repair';

const TITLES: Record<Page, string> = {
  'dashboard':     'Dashboard',
  'agentic-view':  'Agentic View',
  'explorer':      'App Explorer',
  'app-map':       'App Map',
  'test-intake':   'Test Intake',
  'configuration': 'Configuration',
  'robot-setup':   'Robot Setup',
  'camera-test':   'Camera Vision Test',
  'execution':     'Test Execution',
  'monitor':       'Live Monitor',
  'results':       'Test Results',
  'auto-repair':   'Auto-Repair Agent',
};

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const nav = (p: string) => setPage(p as Page);

  // Standalone Auto-Repair window: opened by Live Monitor as ?repair=<id> to make a live repair
  // highly visible in its own window (no sidebar chrome).
  const repairId = new URLSearchParams(window.location.search).get('repair');
  if (repairId) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 20 }}>
        <AutoRepair standaloneRepairId={repairId} />
      </div>
    );
  }

  return (
    <Layout page={page} onNav={nav} title={TITLES[page]}>
      {page === 'dashboard'     && <Dashboard    onNav={nav} />}
      {page === 'agentic-view'  && <AgenticView />}
      {page === 'explorer'      && <AppExplorer  onNav={nav} />}
      {page === 'app-map'       && <AppMapPage />}
      {page === 'test-intake'   && <TestIntake onNav={nav} />}
      {page === 'configuration' && <Configuration onNav={nav} />}
      {page === 'robot-setup'   && <RobotSetup />}
      {page === 'camera-test'   && <CameraVisionTest />}
      {page === 'execution'     && <Execution    onNav={nav} />}
      {page === 'monitor'       && <LiveMonitor />}
      {page === 'results'       && <Results />}
      {page === 'auto-repair'   && <AutoRepair />}
    </Layout>
  );
}
