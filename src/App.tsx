import { useState } from 'react';
import Layout from './components/Layout';
import Dashboard    from './pages/Dashboard';
import AppExplorer  from './pages/AppExplorer';
import AppMapPage   from './pages/AppMap';
import TestIntake   from './pages/TestIntake';
import Configuration from './pages/Configuration';
import RobotSetup    from './pages/RobotSetup';
import Execution    from './pages/Execution';
import LiveMonitor  from './pages/LiveMonitor';
import Results      from './pages/Results';

type Page =
  | 'dashboard' | 'explorer' | 'app-map' | 'test-intake'
  | 'configuration' | 'robot-setup' | 'execution' | 'monitor' | 'results';

const TITLES: Record<Page, string> = {
  'dashboard':     'Dashboard',
  'explorer':      'App Explorer',
  'app-map':       'App Map',
  'test-intake':   'Test Intake',
  'configuration': 'Configuration',
  'robot-setup':   'Robot Setup',
  'execution':     'Test Execution',
  'monitor':       'Live Monitor',
  'results':       'Test Results',
};

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const nav = (p: string) => setPage(p as Page);

  return (
    <Layout page={page} onNav={nav} title={TITLES[page]}>
      {page === 'dashboard'     && <Dashboard    onNav={nav} />}
      {page === 'explorer'      && <AppExplorer  onNav={nav} />}
      {page === 'app-map'       && <AppMapPage />}
      {page === 'test-intake'   && <TestIntake onNav={nav} />}
      {page === 'configuration' && <Configuration onNav={nav} />}
      {page === 'robot-setup'   && <RobotSetup />}
      {page === 'execution'     && <Execution    onNav={nav} />}
      {page === 'monitor'       && <LiveMonitor />}
      {page === 'results'       && <Results />}
    </Layout>
  );
}
