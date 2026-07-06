import { useEffect, useRef, useState } from 'react';
import { api, type Run, type Robot } from '../api/client';
import StatusBadge from '../components/StatusBadge';

// How many consecutive poll failures before showing "Backend offline".
// Vite now waits for the backend TCP port before starting (start-api.cjs),
// so on a healthy startup this threshold is almost never reached.
// Keep at 3 as a safety net for transient glitches (3 × 5 s = 15 s).
const OFFLINE_THRESHOLD = 3;

export default function Dashboard({ onNav }: { onNav: (p: string) => void }) {
  const [runs,      setRuns]     = useState<Run[]>([]);
  const [robots,    setRobots]   = useState<Robot[]>([]);
  const [loading,   setLoading]  = useState(true);
  // null = still checking (first poll not resolved). Avoids a "Backend offline" flash on every
  // mount/refresh before the first health poll comes back. Only `false` (confirmed) shows the banner.
  const [apiOnline, setOnline]   = useState<boolean | null>(null);
  const [hasMap,    setHasMap]   = useState<boolean | null>(null);
  const [mapScr,    setMapScr]   = useState(0);
  const failCount = useRef(0);

  const load = () => {
    Promise.all([api.getRuns(), api.getRobots()])
      .then(([r, rb]) => {
        failCount.current = 0;
        setRuns(r); setRobots(rb.robots ?? []); setOnline(true);
      })
      .catch(() => {
        failCount.current += 1;
        if (failCount.current >= OFFLINE_THRESHOLD) setOnline(false);
      })
      .finally(() => setLoading(false));
    api.getAppMap().then(m => { setHasMap(m.exists); setMapScr(m.exists ? Object.keys(m.screens).length : 0); });
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const recent    = runs.slice(0, 8);
  const passing   = runs.filter(r => r.status === 'completed' && r.failed === 0).length;
  const failing   = runs.filter(r => r.failed > 0 || r.status === 'failed').length;
  const running   = runs.filter(r => r.status === 'running').length;
  const totalTests= runs.reduce((s, r) => s + r.total, 0);
  const totalPass = runs.reduce((s, r) => s + r.passed, 0);
  const passRate  = totalTests ? Math.round((totalPass / totalTests) * 100) : 0;

  // Preconditions for "Start Run"
  const preconditions: { ok: boolean; label: string; fix?: string }[] = [
    { ok: apiOnline === true, label: 'API server reachable' },
    { ok: !!hasMap,  label: `App map explored (${mapScr} screens)`, fix: 'explorer' },
  ];
  const allReady = preconditions.every(p => p.ok);

  return (
    <div>
      {apiOnline === false && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--yellow)', fontSize: 16 }}>⚠</span>
          <span style={{ fontSize: 13 }}>
            <strong style={{ color: 'var(--text)' }}>Backend offline</strong>
            <span className="text-muted"> — API not reachable at port 8001. Run </span>
            <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>npm run dev</code>
            <span className="text-muted"> to auto-start it.</span>
          </span>
        </div>
      )}

      {/* Metrics */}
      <div className="grid-4 section">
        <Metric label="Test Runs"     value={runs.length}    sub="all time" />
        <Metric label="Running Now"   value={running}        sub="active robots"  color={running ? 'var(--yellow)' : undefined} />
        <Metric label="Suite Pass Rate" value={`${passRate}%`} sub={`${totalPass} / ${totalTests} steps`} color={passRate > 90 ? 'var(--green)' : passRate > 70 ? 'var(--yellow)' : totalTests ? 'var(--red)' : undefined} />
        <Metric label="Failing Suites" value={failing}       sub="recent"         color={failing ? 'var(--red)' : runs.length ? 'var(--green)' : undefined} />
      </div>

      <div className="grid-2 section">
        {/* Recent runs */}
        <div className="card">
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="section-title" style={{ marginBottom: 0 }}>Recent Runs</span>
            <span className="spacer" />
            <button className="btn btn-sm btn-secondary" onClick={() => onNav('results')}>All Runs →</button>
          </div>
          {loading ? <p className="text-muted">Loading…</p> : recent.length === 0 ? (
            <p className="text-muted">No runs yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Run ID</th><th>Kiosk</th><th>Status</th><th>Result</th></tr></thead>
                <tbody>
                  {recent.map(r => (
                    <tr key={r.run_id}>
                      <td className="monospace text-accent" style={{ fontSize: 11 }}>{r.run_id.slice(-8)}</td>
                      <td>{r.kiosk_id}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        {r.total > 0 ? (
                          <span>
                            <span style={{ color: 'var(--green)' }}>{r.passed}</span>
                            <span className="text-muted"> / </span>
                            {r.total}
                            {r.failed > 0 && <span style={{ color: 'var(--red)' }}> ({r.failed} fail)</span>}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Robot status */}
        <div className="card">
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="section-title" style={{ marginBottom: 0 }}>Robot Fleet</span>
            <span className="spacer" />
            <button className="btn btn-sm btn-secondary" onClick={load}>↻</button>
          </div>
          {robots.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <p className="text-muted" style={{ fontSize: 12 }}>No robots connected<br />(playwright / demo mode)</p>
            </div>
          ) : robots.map(r => (
            <div key={r.robot_id} className="card card-sm" style={{ marginBottom: 8 }}>
              <div className="row">
                <span className={`dot ${r.connected ? 'dot-green' : 'dot-red'}`} />
                <strong style={{ color: 'var(--text)' }}>{r.robot_id}</strong>
                <span className="text-muted" style={{ fontSize: 11 }}>→ {r.current_kiosk_id || 'none'}</span>
                <span className="spacer" />
                <StatusBadge status={r.arm_state} />
              </div>
            </div>
          ))}

          {/* Precondition check */}
          <div style={{ marginTop: 16 }}>
            <div className="section-title">Run Readiness</div>
            {preconditions.map((p, i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{p.ok ? '✅' : '⬜'}</span>
                <span style={{ fontSize: 12, color: p.ok ? 'var(--text)' : 'var(--muted)' }}>{p.label}</span>
                {!p.ok && p.fix && (
                  <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => onNav(p.fix!)}>
                    Fix →
                  </button>
                )}
              </div>
            ))}
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 10, opacity: allReady ? 1 : 0.5, cursor: allReady ? 'pointer' : 'not-allowed', width: '100%', justifyContent: 'center' }}
              onClick={() => allReady ? onNav('execution') : undefined}
              title={allReady ? undefined : 'Complete the readiness checks above first'}
            >
              {allReady ? '▶ Start New Run' : '▶ Start New Run (not ready)'}
            </button>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid-4 section">
        <QuickAction icon="🔍" label="Explore App"   sub="Discover UI elements"      onClick={() => onNav('explorer')} />
        <QuickAction icon="📋" label="Upload Tests"  sub="Import Excel test cases"    onClick={() => onNav('test-intake')} />
        <QuickAction icon="▶"  label="Run Tests"     sub="Execute on kiosk / robot"   onClick={() => onNav('execution')} />
        <QuickAction icon="📊" label="View Results"  sub="History and artifacts"       onClick={() => onNav('results')} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub, color }: { label: string; value: string | number; sub: string; color?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={color ? { color } : undefined}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}

function QuickAction({ icon, label, sub, onClick }: { icon: string; label: string; sub: string; onClick: () => void }) {
  return (
    <button className="card" style={{ cursor: 'pointer', textAlign: 'left', color: 'var(--text)', background: 'var(--surface)' }} onClick={onClick}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{label}</div>
      <div style={{ fontSize: 12, marginTop: 2, color: 'var(--muted)' }}>{sub}</div>
    </button>
  );
}
