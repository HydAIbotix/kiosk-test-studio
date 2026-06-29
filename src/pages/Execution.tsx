import { useEffect, useState } from 'react';
import { api, type TestCase, type TcPlan, type TcPlanStep } from '../api/client';

const MODES = [
  { value: 'playwright', label: 'Playwright', sub: 'Browser proxy',      icon: '🌐',
    desc: 'Drives Chrome on this machine. Best for development and CI.' },
  { value: 'real',       label: 'Real Robot',  sub: 'Hardware arm',       icon: '🤖',
    desc: 'Commands sent to the physical robotic arm over TCP/IP.' },
  { value: 'demo',       label: 'Demo Mode',   sub: 'Pre-captured screens', icon: '📸',
    desc: 'Uses stored screenshot PNGs. No browser or arm required.' },
];

// Stable colour palette — device aliases get colours by first-seen order
const DEVICE_PALETTE = ['#6366f1','#f59e0b','#22c55e','#3b82f6','#ec4899','#a855f7','#14b8a6','#f97316'];
function buildDeviceColors(plan: TcPlan | null): Record<string, string> {
  const seen: Record<string, string> = {};
  let idx = 0;
  for (const step of plan?.steps ?? []) {
    if (step.device && !(step.device in seen)) {
      seen[step.device] = DEVICE_PALETTE[idx % DEVICE_PALETTE.length];
      idx++;
    }
  }
  return seen;
}

const CH_COLOR: Record<string, string> = {
  robot: '#f59e0b', web: '#3b82f6', db: '#a855f7', validation: '#22c55e',
};

// ── Plan preview for one TC ────────────────────────────────────────────────────
function TcPlanPreview({ tc, plan }: { tc: TestCase; plan: TcPlan | null }) {
  const [open, setOpen] = useState(false);
  const devColors = buildDeviceColors(plan);

  // Group consecutive steps by device, preserving order
  const groups: { device: string | null; steps: { step: TcPlanStep; idx: number }[] }[] = [];
  if (plan) {
    plan.steps.forEach((step, idx) => {
      const dev = step.device ?? null;
      const last = groups[groups.length - 1];
      if (last && last.device === dev) last.steps.push({ step, idx });
      else groups.push({ device: dev, steps: [{ step, idx }] });
    });
  }

  // Badge colours for devices referenced by this TC
  const devList = Object.keys(devColors);

  return (
    <div className="card card-sm" style={{ borderColor: 'rgba(99,102,241,0.3)', padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div className="row" style={{ padding: '8px 12px', cursor: 'pointer', background: 'rgba(99,102,241,0.06)' }}
        onClick={() => setOpen(o => !o)}>
        <span className="monospace" style={{ fontSize: 11, color: 'var(--accent2)', flexShrink: 0 }}>{tc.test_id}</span>
        <span style={{ fontSize: 12, flex: 1, marginLeft: 10, color: 'var(--text)' }}>{tc.summary}</span>
        {/* Device badges */}
        <span style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {devList.map(alias => (
            <span key={alias} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
              background: `${devColors[alias]}22`, color: devColors[alias],
              border: `1px solid ${devColors[alias]}`, flexShrink: 0 }}>{alias}</span>
          ))}
        </span>
        <span style={{ marginLeft: 10, color: 'var(--muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!plan && (
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>
              No execution plan yet — open this test case in Test Intake and generate a plan first.
            </p>
          )}
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.device && (
                <div style={{ fontSize: 10, fontWeight: 700, color: devColors[g.device] ?? 'var(--muted)', letterSpacing: 1, marginBottom: 3, marginTop: gi > 0 ? 6 : 0 }}>
                  ▸ {g.device}
                </div>
              )}
              {g.steps.map(({ step, idx }) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--muted)', minWidth: 18, flexShrink: 0 }}>{idx + 1}.</span>
                  <span style={{ flex: 1, color: 'var(--text)', lineHeight: 1.5 }}>{step.description}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: `${CH_COLOR[step.channel] ?? '#888'}18`, color: CH_COLOR[step.channel] ?? 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {step.channel}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Execution({ onNav }: { onNav: (p: string) => void }) {
  const [mode,       setMode]    = useState('playwright');
  const [robotId,    setRobotId] = useState('R-01');
  const [status,     setStatus]  = useState('');
  const [starting,   setStarting]= useState(false);

  // TC selection — loaded from API, seeded from localStorage selection
  const [availableTcs, setAvailable] = useState<TestCase[]>([]);
  const [selectedIds,  setSelected]  = useState<Set<string>>(() => new Set(api.getSelectedTcs()));
  const [tcLoading,    setTcLoading] = useState(false);
  const [tcError,      setTcError]   = useState('');

  // Cached plans for preview (from localStorage, keyed by test_id)
  const [plans, setPlans] = useState<Record<string, TcPlan | null>>({});

  useEffect(() => {
    setTcLoading(true);
    setTcError('');
    api.getTestCases()
      .then(tcs => {
        setAvailable(tcs);
        // Drop stale saved IDs that no longer exist in the DB
        const validIds = new Set(tcs.map(t => t.test_id));
        setSelected(prev => {
          const cleaned = new Set([...prev].filter(id => validIds.has(id)));
          if (cleaned.size !== prev.size) api.saveSelectedTcs([...cleaned]);
          return cleaned;
        });
      })
      .catch(() => setTcError('Could not load test cases — is the backend running?'))
      .finally(() => setTcLoading(false));
  }, []);

  // Load cached plans from localStorage whenever selection changes
  useEffect(() => {
    const loaded: Record<string, TcPlan | null> = {};
    for (const id of selectedIds) {
      try { loaded[id] = JSON.parse(localStorage.getItem(`tc_plan_${id}`) || 'null'); }
      catch { loaded[id] = null; }
    }
    setPlans(loaded);
  }, [selectedIds]);

  const toggleTc = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      api.saveSelectedTcs([...next]);
      return next;
    });
  };

  const selectAll = () => { const ids = availableTcs.map(t => t.test_id); setSelected(new Set(ids)); api.saveSelectedTcs(ids); };
  const clearAll  = () => { setSelected(new Set()); api.saveSelectedTcs([]); };

  const filterTc = [...selectedIds].join(',') || undefined;
  const selectedTcs = availableTcs.filter(tc => selectedIds.has(tc.test_id));

  const startRun = async () => {
    setStarting(true); setStatus('');
    try {
      const r = await api.startRun({ robot_id: robotId, filter_tc: filterTc, mode });
      setStatus(`Run started: ${r.run_id}`);
      setTimeout(() => onNav('monitor'), 800);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setStarting(false); }
  };

  return (
    <div>
      {/* Mode selector */}
      <div className="section">
        <div className="section-title">Execution Mode</div>
        <div className="grid-3">
          {MODES.map(m => (
            <button key={m.value} onClick={() => setMode(m.value)}
              style={{
                cursor: 'pointer', textAlign: 'left', padding: 16, borderRadius: 8,
                border: `1px solid ${mode === m.value ? 'var(--accent)' : 'var(--border)'}`,
                background: mode === m.value ? 'rgba(99,102,241,0.1)' : 'var(--surface)',
                color: 'var(--text)',
              }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{m.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{m.label}</div>
              <div style={{ fontSize: 11, color: 'var(--accent2)', marginBottom: 6, fontWeight: 500 }}>{m.sub}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{m.desc}</div>
              {mode === m.value && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent2)', fontWeight: 600 }}>✓ Selected</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Left: TC selector */}
        <div className="card section">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Select Test Cases</div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
            Tick the test cases to include in this run. Kiosk routing is determined automatically from each test's steps.
          </p>

          {tcLoading && <p className="text-muted" style={{ fontSize: 12 }}>Loading…</p>}
          {tcError   && <p style={{ fontSize: 12, color: 'var(--red)' }}>{tcError}</p>}

          {!tcLoading && !tcError && availableTcs.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12 }}>
              No test cases in the database. Go to <strong>Test Intake</strong> and import an Excel file first.
            </p>
          )}

          {availableTcs.length > 0 && (
            <>
              <div className="row" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {selectedIds.size === 0 ? 'None selected — all will run' : `${selectedIds.size} of ${availableTcs.length} selected`}
                </span>
                <span className="spacer" />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={selectAll}>All</button>
                  <button className="btn btn-secondary btn-sm" onClick={clearAll}>None</button>
                </div>
              </div>

              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', marginBottom: 14 }}>
                {availableTcs.map(tc => {
                  const checked = selectedIds.has(tc.test_id);
                  return (
                    <label key={tc.test_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 12px', cursor: 'pointer', background: checked ? 'rgba(99,102,241,0.07)' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleTc(tc.test_id)}
                        style={{ accentColor: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent2)' }}>{tc.test_id}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{tc.summary}</div>
                      </div>
                      {tc.kiosk_id && (
                        <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, alignSelf: 'center' }}>{tc.kiosk_id}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Robot ID + start */}
          <div className="form-group">
            <label className="form-label">Robot ID</label>
            <input className="form-input" value={robotId} onChange={e => setRobotId(e.target.value)} style={{ width: 140 }} />
          </div>

          <button className="btn btn-primary" onClick={startRun}
            disabled={starting || availableTcs.length === 0}>
            {starting ? '⏳ Starting…' : `▶ Start Run${selectedIds.size > 0 ? ` (${selectedIds.size} TCs)` : ' (all TCs)'}`}
          </button>

          {status && (
            <div style={{ marginTop: 10, fontSize: 12, color: status.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>
              {status}
            </div>
          )}
        </div>

        {/* Right: execution plan preview */}
        <div className="card section">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Execution Plan Preview</div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
            Steps for each selected test case, grouped by target kiosk. Click a row to expand.
            Plans are generated in <strong>Test Intake</strong>.
          </p>

          {selectedTcs.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <p style={{ fontSize: 13 }}>Select test cases on the left to preview their steps.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }}>
              {selectedTcs.map(tc => (
                <TcPlanPreview key={tc.test_id} tc={tc} plan={plans[tc.test_id] ?? null} />
              ))}
            </div>
          )}

          {selectedTcs.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
              <span style={{ color: CH_COLOR.robot }}>■</span> robot &nbsp;
              <span style={{ color: CH_COLOR.web }}>■</span> web &nbsp;
              <span style={{ color: CH_COLOR.validation }}>■</span> validate &nbsp;
              <span style={{ color: 'var(--muted)' }}>— device colours assigned dynamically from your Device Map</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
