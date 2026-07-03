import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';

type Page =
  | 'dashboard' | 'explorer' | 'app-map' | 'test-intake'
  | 'configuration' | 'robot-setup' | 'execution' | 'monitor' | 'results';

const NAV: { group: string; items: { id: Page; icon: string; label: string }[] }[] = [
  {
    group: 'Overview',
    items: [{ id: 'dashboard', icon: '⬡', label: 'Dashboard' }],
  },
  {
    group: 'App Analysis',
    items: [
      { id: 'explorer', icon: '🔍', label: 'App Explorer' },
      { id: 'app-map',  icon: '🗺',  label: 'App Map' },
    ],
  },
  {
    group: 'Testing',
    items: [
      { id: 'test-intake',   icon: '📋', label: 'Test Intake' },
      { id: 'execution',     icon: '▶',  label: 'Test Execution' },
      { id: 'monitor',       icon: '📡', label: 'Live Monitor' },
      { id: 'results',       icon: '📊', label: 'Results' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { id: 'configuration', icon: '⚙',  label: 'Configuration' },
      { id: 'robot-setup',   icon: '🤖', label: 'Robot Setup' },
    ],
  },
];

function ResetButton() {
  const [confirm, setConfirm] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState('');
  const ctrlRef = useRef<AbortController | null>(null);

  const cancel = () => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setBusy(false);
    setConfirm(false);
    setError('');
  };

  const run = async () => {
    setBusy(true);
    setError('');
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      await api.resetAll(ctrl.signal);
      if (ctrl.signal.aborted) return;   // user cancelled — do nothing
      // Clear only cached test plans (regenerated on demand) to match the backend.
      // Test-case config, selections, and credentials are preserved.
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('tc_plan_')) localStorage.removeItem(k);
      });
      setDone(true);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      if (ctrl.signal.aborted) return;   // cancelled — ignore the AbortError
      setError(e instanceof Error ? e.message : 'Reset failed — is the API server running?');
      setBusy(false);
    } finally {
      ctrlRef.current = null;
    }
  };

  if (done) return (
    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--green)', textAlign: 'center' }}>
      ✓ Reset complete — reloading…
    </div>
  );

  if (confirm) return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
      {!busy && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          Deletes all generated test plans, test runs and results. Does not impact App map, raw test cases and global config.
        </p>
      )}
      {busy && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          Resetting — this may take up to 30s…
        </p>
      )}
      {error && (
        <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8, lineHeight: 1.4 }}>
          ✗ {error}
        </p>
      )}
      <button
        onClick={run}
        disabled={busy}
        style={{ width: '100%', padding: '7px', marginBottom: 6, borderRadius: 6, border: '1px solid var(--red)', background: 'rgba(239,68,68,0.15)', color: 'var(--red)', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600 }}
      >
        {busy ? '⏳ Resetting…' : 'Yes, reset everything'}
      </button>
      <button
        onClick={cancel}
        style={{ width: '100%', padding: '7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}
      >
        {busy ? 'Abort & cancel' : 'Cancel'}
      </button>
    </div>
  );

  return (
    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setConfirm(true)}
        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--red)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--red)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; }}
      >
        <span>↺</span> Reset
      </button>
    </div>
  );
}

export default function Layout({
  page, onNav, children, title, actions,
}: {
  page: Page;
  onNav: (p: Page) => void;
  children: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>Kiosk Test Studio</h1>
          <p>AI Test Automation</p>
        </div>
        <div style={{ flex: 1 }}>
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-label">{g.group}</div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${page === item.id ? ' active' : ''}`}
                  onClick={() => onNav(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <ResetButton />
      </aside>

      <div className="main">
        <div className="topbar">
          <h2>{title}</h2>
          <div className="topbar-actions">{actions}</div>
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
