import { useEffect, useState } from 'react';
import { api, type TestCase, type TcPlan, type TcPlanStep } from '../api/client';
import { planSig } from './TestIntake';

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

// Group selected test cases by the kiosk they run on, so the operator sees at a glance which
// kiosk each test (and its plan) targets.  The backend resolves the real target kiosk from the
// Device Map at run time; this mirrors the same kiosk_id carried on each test case.
function groupByKiosk(tcs: TestCase[]): [string, TestCase[]][] {
  const groups: Record<string, TestCase[]> = {};
  for (const tc of tcs) {
    const kid = tc.kiosk_id || 'unassigned';
    (groups[kid] ??= []).push(tc);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

// ── Plan preview for one TC ────────────────────────────────────────────────────
function TcPlanPreview({ tc, plan }: { tc: TestCase; plan: TcPlan | null }) {
  const [open, setOpen] = useState(false);
  const devColors = buildDeviceColors(plan);

  // Group steps by target device.  When every step runs on the SAME device (the common case),
  // show a single device header for the whole plan.  Only when steps genuinely span MULTIPLE
  // devices do we split into per-device groups — and steps without a device (e.g. validations)
  // stay in the current group instead of breaking it into a fresh header.
  const groups: { device: string | null; steps: { step: TcPlanStep; idx: number }[] }[] = [];
  if (plan) {
    const distinctDevices = [...new Set(plan.steps.map(s => s.device).filter(Boolean))] as string[];
    if (distinctDevices.length <= 1) {
      groups.push({ device: distinctDevices[0] ?? null, steps: plan.steps.map((step, idx) => ({ step, idx })) });
    } else {
      plan.steps.forEach((step, idx) => {
        const dev = step.device ?? null;
        const last = groups[groups.length - 1];
        if (dev && (!last || last.device !== dev)) groups.push({ device: dev, steps: [{ step, idx }] });
        else if (!last) groups.push({ device: null, steps: [{ step, idx }] });
        else last.steps.push({ step, idx });
      });
    }
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
  const [backend,  setBackend] = useState('');   // execution backend — read from Configuration
  const [robotId,  setRobotId] = useState('R-01');
  const [status,   setStatus]  = useState('');
  const [starting, setStarting]= useState(false);

  // The execution backend has a SINGLE source of truth: Configuration → Robot Connection.
  useEffect(() => { api.getConfig().then(c => setBackend(c.robot_backend)).catch(() => {}); }, []);

  // Selection AND run order are persisted in localStorage (`selected_tcs` is an ordered array).
  // Test Intake decides WHICH tests; this page decides the ORDER they execute in — the suite runs
  // top-to-bottom in exactly this order (the backend honors the id order sent in `filter_tc`).
  const [orderedIds, setOrderedIds] = useState<string[]>(() => api.getSelectedTcs());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const selectedIds = new Set<string>(orderedIds);

  // Load TC details from API so we can display summaries and resolve plans
  const [availableTcs, setAvailable] = useState<TestCase[]>([]);
  const [tcLoading,    setTcLoading] = useState(false);

  // Cached plans for preview (from localStorage, keyed by test_id)
  const [plans, setPlans] = useState<Record<string, TcPlan | null>>({});

  useEffect(() => {
    setTcLoading(true);
    api.getTestCases()
      .then(tcs => setAvailable(tcs))
      .finally(() => setTcLoading(false));
  }, []);

  useEffect(() => {
    const loaded: Record<string, TcPlan | null> = {};
    for (const id of selectedIds) {
      try {
        const raw = localStorage.getItem(`tc_plan_${id}`);
        const p = raw ? (JSON.parse(raw) as TcPlan & { _src?: string }) : null;
        const tc = availableTcs.find(t => t.test_id === id);
        // hide a cached plan whose source test case has changed since it was generated
        loaded[id] = (p && tc && p._src !== undefined && p._src !== planSig(tc)) ? null : p;
      } catch { loaded[id] = null; }
    }
    setPlans(loaded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTcs]);

  // Render + run in the operator's chosen order (orderedIds), NOT availableTcs/test_id order.
  const tcById      = new Map(availableTcs.map(tc => [tc.test_id, tc]));
  const selectedTcs = orderedIds.map(id => tcById.get(id)).filter((t): t is TestCase => !!t);
  const filterTc    = orderedIds.join(',') || undefined;

  // Reorder helpers — persist immediately so the chosen order survives navigation and is what runs.
  const persistOrder = (ids: string[]) => { setOrderedIds(ids); api.saveSelectedTcs(ids); };
  const moveBy = (idx: number, delta: number) => {
    const j = idx + delta;
    if (j < 0 || j >= orderedIds.length) return;
    const next = orderedIds.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    persistOrder(next);
  };
  const dropOn = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    const next = orderedIds.slice();
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    persistOrder(next);
    setDragIdx(null);
  };

  const startRun = async () => {
    setStarting(true); setStatus('');
    try {
      const r = await api.startRun({ robot_id: robotId, filter_tc: filterTc, mode: backend });
      setStatus(`Run started: ${r.run_id}`);
      setTimeout(() => onNav('monitor'), 800);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setStarting(false); }
  };

  return (
    <div>
      {/* Execution backend — read-only; set in Configuration → Robot Connection */}
      <div className="section">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>Execution Backend</div>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" onClick={() => onNav('configuration')}>
            Change in Configuration →
          </button>
        </div>
        {(() => {
          const m = MODES.find(x => x.value === backend);
          return (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderColor: 'var(--accent)' }}>
              <div style={{ fontSize: 26 }}>{m?.icon ?? '⏳'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {m?.label ?? (backend ? backend : 'Loading…')}
                  {backend === 'real' && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent2)' }}>(verify in Robot Setup)</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {m?.desc ?? 'Backend is chosen once in Configuration → Robot Connection and used for every run.'}
                </div>
              </div>
              {backend === 'real' && (
                <button className="btn btn-secondary btn-sm" onClick={() => onNav('robot-setup')}>Robot Setup →</button>
              )}
            </div>
          );
        })()}
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Left: selected TCs (read-only) + start */}
        <div className="card section">
          <div className="row" style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Selected Test Cases</div>
            <span className="spacer" />
            <button className="btn btn-secondary btn-sm" onClick={() => onNav('test-intake')}>
              Edit in Test Intake →
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
            {orderedIds.length === 0
              ? 'No test cases selected — all will run. Go to Test Intake to make a selection.'
              : `${orderedIds.length} test case${orderedIds.length > 1 ? 's' : ''} queued — they run in the order below.`}
          </p>

          {tcLoading && <p className="text-muted" style={{ fontSize: 12 }}>Loading…</p>}

          {!tcLoading && selectedTcs.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 14, overflow: 'hidden' }}>
              {/* Run-order header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(99,102,241,0.08)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--accent2)', fontFamily: 'monospace' }}>RUN ORDER</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>· drag ≡ or use ↑ ↓ — executes top-to-bottom</span>
              </div>
              {/* Reorderable rows — drag-and-drop OR up/down buttons; order is what the suite runs */}
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {selectedTcs.map((tc, idx) => (
                  <div
                    key={tc.test_id}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropOn(idx)}
                    onDragEnd={() => setDragIdx(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                      borderBottom: '1px solid var(--border)',
                      background: dragIdx === idx ? 'rgba(99,102,241,0.14)' : 'transparent',
                      cursor: 'grab',
                    }}
                  >
                    <span title="Drag to reorder" style={{ color: 'var(--muted)', fontSize: 15, userSelect: 'none' }}>≡</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', width: 18, textAlign: 'right', fontFamily: 'monospace' }}>{idx + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent2)' }}>{tc.test_id}</span>
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'rgba(99,102,241,0.12)', color: 'var(--accent2)', fontFamily: 'monospace' }}>{tc.kiosk_id || 'unassigned'}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tc.summary}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button className="btn btn-secondary" onClick={() => moveBy(idx, -1)} disabled={idx === 0}
                        title="Move up" style={{ padding: '0 6px', fontSize: 11, lineHeight: '16px', minWidth: 22 }}>↑</button>
                      <button className="btn btn-secondary" onClick={() => moveBy(idx, 1)} disabled={idx === selectedTcs.length - 1}
                        title="Move down" style={{ padding: '0 6px', fontSize: 11, lineHeight: '16px', minWidth: 22 }}>↓</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Robot ID + start */}
          <div className="form-group">
            <label className="form-label">Robot ID</label>
            <input className="form-input" value={robotId} onChange={e => setRobotId(e.target.value)} style={{ width: 140 }} />
          </div>

          <button className="btn btn-primary" onClick={startRun} disabled={starting}>
            {starting ? '⏳ Starting…' : `▶ Start Run${orderedIds.length > 0 ? ` (${orderedIds.length} TCs)` : ' (all TCs)'}`}
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
            Steps for each selected test case, grouped by target device. Click a row to expand.
            Plans are generated in <strong>Test Intake</strong>.
          </p>

          {selectedTcs.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <p style={{ fontSize: 13 }}>No test cases selected. Go to Test Intake to select test cases for this run.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 500, overflowY: 'auto' }}>
              {groupByKiosk(selectedTcs).map(([kid, tcs]) => (
                <div key={kid} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* One plan group per kiosk — the plans below all execute on this kiosk */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>🖥️</span>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--accent2)', fontFamily: 'monospace' }}>{kid}</span>
                    <span style={{ height: 1, flex: 1, background: 'var(--border)' }} />
                  </div>
                  {tcs.map(tc => (
                    <TcPlanPreview key={tc.test_id} tc={tc} plan={plans[tc.test_id] ?? null} />
                  ))}
                </div>
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
