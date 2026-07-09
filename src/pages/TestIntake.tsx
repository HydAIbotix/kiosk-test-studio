import { useEffect, useRef, useState } from 'react';
import { api, type TestCase, type TcConfig, type TcPlan, type TcPlanStep } from '../api/client';

// ── Plan storage key ───────────────────────────────────────────────────────────
const PLAN_KEY = (id: string) => `tc_plan_${id}`;

// Signature of the test-case content that determines the plan.  Stored with each cached plan so a
// cached plan is treated as STALE (and regenerated) when the test case is edited/re-imported —
// even if only the expected result (e.g. a $ amount to verify) changed.
export function planSig(tc: { steps_raw?: string; expected_results_raw?: string; description?: string }): string {
  // Leading token bumped in lock-step with the backend _PLANNER_VERSION so cached plan
  // previews regenerate when the planner output shape changes (e.g. value_element_id anchors).
  return `v10¶${tc.steps_raw ?? ''}¶${tc.expected_results_raw ?? ''}¶${tc.description ?? ''}`;
}

function loadCachedPlan(id: string, tc?: { steps_raw?: string; expected_results_raw?: string; description?: string }): TcPlan | null {
  try {
    const p = JSON.parse(localStorage.getItem(PLAN_KEY(id)) || 'null');
    if (!p) return null;
    // If we know the current test case, drop the cache when its content no longer matches.
    if (tc && p._src !== undefined && p._src !== planSig(tc)) return null;
    return p;
  } catch { return null; }
}
function saveCachedPlan(id: string, plan: TcPlan, tc?: { steps_raw?: string; expected_results_raw?: string; description?: string }) {
  const withSig = tc ? { ...plan, _src: planSig(tc) } : plan;
  localStorage.setItem(PLAN_KEY(id), JSON.stringify(withSig));
}
function deleteCachedPlan(id: string) {
  localStorage.removeItem(PLAN_KEY(id));
}

// ── Channel display ────────────────────────────────────────────────────────────
type Channel = 'robot' | 'web' | 'db' | 'validation';

const CH: Record<Channel, { color: string; bg: string; label: string }> = {
  robot:      { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: '🤖 robot' },
  web:        { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  label: '🌐 web' },
  db:         { color: '#a855f7', bg: 'rgba(168,85,247,0.12)',  label: '🗄 db' },
  validation: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: '✓ validate' },
};

function ChannelBadge({ ch }: { ch: string }) {
  const s = CH[ch as Channel] ?? { color: 'var(--muted)', bg: 'var(--surface2)', label: ch };
  return (
    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: s.bg, color: s.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {s.label}
    </span>
  );
}

// ── Plan viewer / editor ───────────────────────────────────────────────────────

function PlanStep({ step, idx }: { step: TcPlanStep; idx: number }) {
  const ch = CH[step.channel as Channel] ?? CH.robot;
  const isRobot = step.channel === 'robot';
  const hasCo   = isRobot && step.px != null && step.py != null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 12 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 20, paddingTop: 2 }}>{idx + 1}.</span>
      <div style={{ flex: 1, lineHeight: 1.6 }}>
        <span style={{ color: 'var(--text)' }}>{step.description}</span>
        {hasCo && (
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            [{step.screen_id} · {step.element_id} · ({step.px},{step.py})]
          </span>
        )}
        {step.action === 'type' && step.value && (
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--accent2)', fontFamily: 'monospace' }}>→ &quot;{step.value}&quot;</span>
        )}
        {step.detail && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{step.detail}</div>
        )}
      </div>
      <ChannelBadge ch={step.channel} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TestIntake({ onNav }: { onNav: (p: string) => void }) {
  const [cases,      setCases]    = useState<TestCase[]>([]);
  const [selected,   setSel]      = useState<TestCase | null>(null);
  const [checked,    setChecked]  = useState<Set<string>>(() => new Set(api.getSelectedTcs()));
  const [uploading,  setUploading]= useState(false);
  const [uploadMsg,  setUploadMsg]= useState('');
  const [search,     setSearch]   = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [tcConfigs,  setTcConfigs]= useState<Record<string, TcConfig>>({});
  const [cfgSaved,   setCfgSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Per-selected-TC plan state
  const [plan,       setPlan]     = useState<TcPlan | null>(null);
  const [planStatus, setPlanSt]   = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [planErr,    setPlanErr]  = useState('');
  const [planEditing,setPlanEd]   = useState(false);
  const [editedSteps,setEditedSt] = useState<TcPlanStep[]>([]);
  const [planSaved,  setPlanSaved]= useState(false);

  const load = () => api.getTestCases().then(cs => {
    setCases(cs);
    // keep the selected test case in sync with the latest DB content (e.g. after re-import)
    setSel(prev => prev ? (cs.find(c => c.test_id === prev.test_id) ?? prev) : prev);
  });
  useEffect(() => { load(); }, []);
  useEffect(() => { api.saveSelectedTcs(Array.from(checked)); }, [checked]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadMsg('');
    try {
      const r = await api.uploadTestCases(file);
      setUploadMsg(`Imported ${r.imported} test cases (${r.new} new)`);
      load();
    } catch (err) {
      setUploadMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setUploading(false); }
  };

  const toggleCheck = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === filtered.length) setChecked(new Set());
    else setChecked(new Set(filtered.map(c => c.test_id)));
  };

  const saveCfg = (test_id: string, key: string, val: string) => {
    const cfg = { ...(tcConfigs[test_id] || {}), [key]: val };
    setTcConfigs(prev => ({ ...prev, [test_id]: cfg }));
    api.saveTcConfig(test_id, cfg);         // auto-save on every keystroke
  };

  const saveCfgExplicit = (test_id: string) => {
    const cfg = tcConfigs[test_id] || api.getTcConfig(test_id) || {};
    api.saveTcConfig(test_id, cfg);
    setCfgSaved(true);
    setTimeout(() => setCfgSaved(false), 2000);
  };

  // Fetch or load plan for a test case
  const fetchPlan = async (tc: TestCase, force = false) => {
    setPlan(null); setPlanSt('loading'); setPlanErr(''); setPlanEd(false);

    if (!force) {
      const cached = loadCachedPlan(tc.test_id, tc);
      if (cached) { setPlan(cached); setPlanSt('ready'); return; }
    }

    try {
      const p = await api.getTcPlan({
        test_id: tc.test_id, summary: tc.summary,
        description: tc.description, steps_raw: tc.steps_raw,
        expected_results_raw: tc.expected_results_raw,
        ...(force ? { force: true } : {}),
      });
      saveCachedPlan(tc.test_id, p, tc);
      setPlan(p); setPlanSt('ready');
    } catch (e) {
      setPlanSt('error');
      setPlanErr(e instanceof Error ? e.message : String(e));
    }
  };

  const selectTc = (tc: TestCase) => {
    setSel(tc); setPlanEd(false); setPlanSaved(false);
    const saved = api.getTcConfig(tc.test_id);
    if (saved) setTcConfigs(prev => ({ ...prev, [tc.test_id]: saved }));
    fetchPlan(tc);
  };

  // Plan editing
  const startEdit = () => { if (plan) { setEditedSt(plan.steps.map(s => ({ ...s }))); setPlanEd(true); } };
  const cancelEdit = () => setPlanEd(false);
  const savePlan = () => {
    if (!plan || !selected) return;
    const updated = { ...plan, steps: editedSteps };
    saveCachedPlan(selected.test_id, updated);
    setPlan(updated); setPlanEd(false); setPlanSaved(true);
    setTimeout(() => setPlanSaved(false), 2000);
  };
  const resetPlan = async () => {
    if (!selected) return;
    deleteCachedPlan(selected.test_id);
    await api.deleteTcPlan(selected.test_id);
    fetchPlan(selected, true);
  };
  const updateStep = (i: number, field: keyof TcPlanStep, val: string) =>
    setEditedSt(prev => prev.map((s, j) => j === i ? { ...s, [field]: val } : s));
  const addStep = () => setEditedSt(prev => [...prev, { action: 'tap', channel: 'robot', description: '' }]);
  const removeStep = (i: number) => setEditedSt(prev => prev.filter((_, j) => j !== i));

  const filtered = cases.filter(c =>
    (!selectedOnly || checked.has(c.test_id)) &&
    (search === '' ||
     c.test_id.toLowerCase().includes(search.toLowerCase()) ||
     c.summary.toLowerCase().includes(search.toLowerCase()))
  );

  const allChecked = filtered.length > 0 && filtered.every(c => checked.has(c.test_id));

  // Config fields come from Claude's plan (required_config), not from regex.
  // Defensive: Claude occasionally emits a malformed entry (missing key/label); drop keyless
  // ones and fall back to the key for a missing label so a bad plan can never crash the page.
  const credFields  = (plan?.required_config ?? [])
    .filter(f => f && f.key)
    .map(f => ({ ...f, label: f.label || f.key }));
  const selCfg      = selected ? (tcConfigs[selected.test_id] || api.getTcConfig(selected.test_id) || {}) : {};
  const allFilled   = credFields.every(f => selCfg[f.key]?.trim());

  return (
    <div>
      {/* Multi-device guidance */}
      <div className="card section" style={{ borderColor: 'rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.06)' }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>
          <strong>Multi-device tests:</strong> write each step with the <strong>device abbreviation</strong> it targets
          (e.g. <code>CARD</code>, <code>SHOP</code>) — the same abbreviations you map to Kiosk-IDs in{' '}
          <strong>Configuration&nbsp;→&nbsp;Device&nbsp;Map</strong>. The planner tags each step with its device and the
          robot moves to that device's position (steps without a device stay on the current one). This lets one test
          load a card at one kiosk, buy at another, and return to check the updated balance.
        </div>
      </div>

      {/* Controls */}
      <div className="card section">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Import Test Cases (.xlsx)</label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? '⏳ Uploading…' : '📁 Choose File'}
              </button>
              <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={upload} />
              {uploadMsg && <span style={{ fontSize: 12, color: uploadMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{uploadMsg}</span>}
            </div>
          </div>
          <span className="spacer" />
          <div>
            <label className="form-label">Search</label>
            <input className="form-input" style={{ width: 210 }} value={search}
              onChange={e => setSearch(e.target.value)} placeholder="test ID or keyword…" />
          </div>
          <div>
            <label className="form-label">&nbsp;</label>
            <button className="btn btn-secondary btn-sm"
              onClick={() => setSelectedOnly(v => !v)}
              disabled={checked.size === 0 && !selectedOnly}
              title="Show only test cases selected for the run"
              style={{ borderColor: selectedOnly ? '#6366f1' : 'var(--border)', color: selectedOnly ? '#6366f1' : 'var(--text)' }}>
              {selectedOnly ? `✓ Selected only (${checked.size})` : `Selected only (${checked.size})`}
            </button>
          </div>
        </div>
      </div>

      {/* Selection banner */}
      <div className="card section" style={{
        borderColor: checked.size > 0 ? 'rgba(99,102,241,0.5)' : 'var(--border)',
        background: checked.size > 0 ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
      }}>
        <div className="row">
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {checked.size === 0
                ? 'Select test cases to execute'
                : `${checked.size} test case${checked.size > 1 ? 's' : ''} selected`}
            </div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {checked.size === 0
                ? 'Tick the checkboxes next to each test case you want to include in the next run.'
                : 'These will be sent to the Execution page when you proceed.'}
            </p>
          </div>
          <span className="spacer" />
          {checked.size > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setChecked(new Set())}>Clear selection</button>
              <button className="btn btn-primary btn-sm" onClick={() => onNav('execution')}>Proceed to Execution →</button>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        {/* Test case list */}
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="section-title" style={{ marginBottom: 0 }}>
              Test Cases ({filtered.length} / {cases.length})
            </span>
            {filtered.length > 0 && (
              <button className="btn btn-sm btn-secondary" onClick={toggleAll}>
                {allChecked ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 12 }}>No test cases yet. Import an Excel file.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>ID</th><th>Summary</th><th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(tc => (
                    <tr key={tc.test_id}
                      style={{ cursor: 'pointer', background: selected?.test_id === tc.test_id ? 'var(--surface2)' : undefined }}
                      onClick={() => selectTc(tc)}>
                      <td style={{ paddingLeft: 12 }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={checked.has(tc.test_id)} onChange={() => toggleCheck(tc.test_id)}
                          style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 14, height: 14 }} />
                      </td>
                      <td className="monospace" style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--accent2)' }}>{tc.test_id}</td>
                      <td style={{ fontSize: 12 }}>{tc.summary}</td>
                      <td><span className={`badge badge-${tc.priority === 'High' ? 'red' : tc.priority === 'Medium' ? 'yellow' : 'muted'}`}>{tc.priority}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {selected ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <div>
                  <code className="text-accent" style={{ fontSize: 12 }}>{selected.test_id}</code>
                  <div style={{ fontWeight: 600, marginTop: 3 }}>{selected.summary}</div>
                </div>
                <span className="spacer" />
                <div className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={checked.has(selected.test_id)}
                    onChange={() => toggleCheck(selected.test_id)}
                    style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 15, height: 15 }} />
                  <span style={{ fontSize: 12 }}>Include in run</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setSel(null)}>✕</button>
                </div>
              </div>

              {/* Description */}
              <div className="form-group">
                <div className="form-label">Description</div>
                <div className="raw-box">{selected.description || '—'}</div>
              </div>

              {/* Claude-generated plan */}
              <div className="form-group">
                <div className="row" style={{ marginBottom: 6 }}>
                  <div className="form-label" style={{ marginBottom: 0 }}>
                    Execution Plan
                    {plan?.generated_at && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>generated by Claude</span>}
                    {planSaved && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--green)', fontWeight: 400 }}>✓ saved!</span>}
                  </div>
                  <span className="spacer" />
                  {planStatus === 'ready' && !planEditing && (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={startEdit} style={{ fontSize: 11 }}>✏ Edit</button>
                      <button className="btn btn-secondary btn-sm" onClick={resetPlan} style={{ fontSize: 11 }} title="Regenerate via Claude">↺ Regenerate</button>
                    </div>
                  )}
                  {planEditing && (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={savePlan} style={{ fontSize: 11 }}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={cancelEdit} style={{ fontSize: 11 }}>Cancel</button>
                    </div>
                  )}
                </div>

                {/* Loading */}
                {planStatus === 'loading' && (
                  <div style={{ padding: '12px 0' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                      ⏳ Generating plan with Claude…
                    </div>
                    <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--accent)', animation: 'explore-progress 1.5s ease-in-out infinite', width: '35%' }} />
                    </div>
                  </div>
                )}

                {/* Error */}
                {planStatus === 'error' && (
                  <div style={{ padding: '10px 12px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--red)' }}>✗ {planErr}</span>
                    <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={() => fetchPlan(selected)}>Retry</button>
                  </div>
                )}

                {/* View mode */}
                {planStatus === 'ready' && plan && !planEditing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {plan.steps.map((s, i) => <PlanStep key={i} step={s} idx={i} />)}
                  </div>
                )}

                {/* Edit mode */}
                {planEditing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {editedSteps.map((s, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 20 }}>{i + 1}.</span>
                        <input value={s.description} onChange={e => updateStep(i, 'description', e.target.value)}
                          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12 }} />
                        <select value={s.channel} onChange={e => updateStep(i, 'channel', e.target.value as TcPlanStep['channel'])}
                          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 11, padding: '2px 4px' }}>
                          <option value="robot">🤖 robot</option>
                          <option value="web">🌐 web</option>
                          <option value="db">🗄 db</option>
                          <option value="validation">✓ validate</option>
                        </select>
                        <button onClick={() => removeStep(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>×</button>
                      </div>
                    ))}
                    <button className="btn btn-secondary btn-sm" onClick={addStep} style={{ fontSize: 11, alignSelf: 'flex-start', marginTop: 2 }}>+ Add Step</button>
                  </div>
                )}

                {planStatus === 'idle' && (
                  <button className="btn btn-primary btn-sm" onClick={() => fetchPlan(selected)} style={{ marginTop: 4 }}>
                    Generate Plan with Claude
                  </button>
                )}

                <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  🤖 robot = kiosk touchscreen tap/type · 🌐 web = external app (CRM, admin portal) · 🗄 db = database check · ✓ validate = assertion
                </p>
              </div>

              {/* Config inputs — from Claude's required_config */}
              {planStatus === 'ready' && credFields.length > 0 && (
                <div className="form-group">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <div className="form-label" style={{ marginBottom: 0 }}>
                      Required Test Inputs
                      <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--muted)' }}>— stored in browser</span>
                    </div>
                    <span className="spacer" />
                    {cfgSaved
                      ? <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>✓ Saved!</span>
                      : <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => saveCfgExplicit(selected.test_id)}>
                          Save inputs
                        </button>
                    }
                  </div>
                  <div className="card card-sm" style={{ borderColor: allFilled ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)', background: allFilled ? 'rgba(34,197,94,0.04)' : 'rgba(245,158,11,0.04)' }}>
                    {!allFilled && <p style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 10 }}>⚠ Fill all required inputs before running this test.</p>}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {credFields.map(f => (
                        <div key={f.key}>
                          <label className="form-label">{f.label}</label>
                          <input
                            className="form-input"
                            type={f.type === 'password' ? 'password' : 'text'}
                            value={selCfg[f.key] || ''}
                            onChange={e => saveCfg(selected.test_id, f.key, e.target.value)}
                            placeholder={`Enter ${f.label.toLowerCase()}`}
                          />
                        </div>
                      ))}
                    </div>
                    {allFilled && (
                      <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 10 }}>
                        ✓ All inputs provided — inputs auto-save as you type; click "Save inputs" to confirm.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Raw steps */}
              <div className="form-group">
                <div className="form-label">Raw Steps</div>
                <div className="raw-box">{selected.steps_raw || '—'}</div>
              </div>
              <div className="form-group">
                <div className="form-label">Expected Results</div>
                <div className="raw-box">{selected.expected_results_raw || '—'}</div>
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <p>Click a test case to see its details, Claude-generated plan, and required inputs.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
