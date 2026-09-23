import { useEffect, useRef, useState } from 'react';
import { api, annotatedScreenshotUrl, type TestCase, type TcConfig, type TcPlan, type TcPlanStep, type TcReview } from '../api/client';

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

// A click/type step points at a concrete UI element — show the annotated exploration screenshot of that
// screen (the same labelled frame the explorer produced) as a thumbnail; click to enlarge.
function isInteractionStep(step: TcPlanStep): boolean {
  const a = (step.action || '').toLowerCase();
  return /tap|click|type|press|select|enter/.test(a) || (step.px != null && step.py != null) || !!step.element_id;
}

function PlanStep({ step, idx, shotFor }: { step: TcPlanStep; idx: number; shotFor?: (screenId?: string) => string | undefined }) {
  const ch = CH[step.channel as Channel] ?? CH.robot;
  const isRobot = step.channel === 'robot';
  const hasCo   = isRobot && step.px != null && step.py != null;
  const [zoom, setZoom] = useState(false);
  const shot = isInteractionStep(step) ? shotFor?.(step.screen_id) : undefined;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 12 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 20, paddingTop: 2 }}>{idx + 1}.</span>
      {shot && (
        <img src={annotatedScreenshotUrl(shot)} alt={`${step.screen_id} annotated`} onClick={() => setZoom(true)}
          title="Click to enlarge the annotated screenshot"
          style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)',
            cursor: 'zoom-in', flexShrink: 0, background: '#000' }} />
      )}
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
      {zoom && shot && (
        <div onClick={() => setZoom(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', fontSize: 13 }}>
              <span>Step {idx + 1} · {step.screen_id}{step.element_id ? ` · ${step.element_id}` : ''}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setZoom(false)}>✕ Close</button>
            </div>
            <img src={annotatedScreenshotUrl(shot)} alt={`${step.screen_id} annotated`}
              style={{ maxWidth: '92vw', maxHeight: '84vh', objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pager (First ‹ Prev  1 2 … N  Next › End) ────────────────────────────────────
// `statusOf` colours each numbered page by its review status so the reviewer sees progress at a glance.
function windowedPages(cur: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out = new Set<number>([0, total - 1, cur, cur - 1, cur + 1]);
  const pages = [...out].filter(p => p >= 0 && p < total).sort((a, b) => a - b);
  const withGaps: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) withGaps.push(-1); // ellipsis marker
    withGaps.push(pages[i]);
  }
  return withGaps;
}

function Pager({ cur, total, go, statusOf }: {
  cur: number; total: number; go: (i: number) => void;
  statusOf?: (i: number) => 'approved' | 'rejected' | 'pending';
}) {
  if (total <= 1) return null;
  const dot = (s?: string) => s === 'approved' ? 'var(--green)' : s === 'rejected' ? 'var(--red)' : 'var(--muted)';
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} disabled={cur === 0} onClick={() => go(0)}>« First</button>
      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} disabled={cur === 0} onClick={() => go(cur - 1)}>‹ Prev</button>
      {windowedPages(cur, total).map((p, i) => p < 0
        ? <span key={`e${i}`} style={{ color: 'var(--muted)', padding: '0 2px' }}>…</span>
        : (
          <button key={p} onClick={() => go(p)}
            title={statusOf ? `Plan ${p + 1} — ${statusOf(p)}` : `Plan ${p + 1}`}
            style={{
              minWidth: 26, height: 26, borderRadius: 5, fontSize: 11, cursor: 'pointer',
              border: `1px solid ${p === cur ? 'var(--accent)' : 'var(--border)'}`,
              background: p === cur ? 'var(--accent)' : 'var(--surface)',
              color: p === cur ? '#fff' : 'var(--text)',
              position: 'relative', fontWeight: p === cur ? 700 : 400,
            }}>
            {p + 1}
            {statusOf && (
              <span style={{ position: 'absolute', top: 2, right: 3, width: 5, height: 5, borderRadius: 5, background: dot(statusOf(p)) }} />
            )}
          </button>
        ))}
      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} disabled={cur === total - 1} onClick={() => go(cur + 1)}>Next ›</button>
      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} disabled={cur === total - 1} onClick={() => go(total - 1)}>End »</button>
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
  const [annShots,   setAnnShots] = useState<Record<string, string[]>>({});
  const [planStatus, setPlanSt]   = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [planErr,    setPlanErr]  = useState('');
  const [planEditing,setPlanEd]   = useState(false);
  const [editedSteps,setEditedSt] = useState<TcPlanStep[]>([]);
  const [planSaved,  setPlanSaved]= useState(false);
  const [hrTestPlan, setHrTestPlan]= useState(false);
  const [hrExplorer, setHrExplorer]= useState(false);
  const [explorerOk, setExplorerOk]= useState(true);
  const [planApproved, setPlanApproved]= useState(false);
  const [planRejecting, setPlanRejecting]= useState(false);
  const [planReason, setPlanReason]= useState('');

  // ── Bulk plan-generation + review flow ─────────────────────────────────────────
  // phase: 'list' = the classic per-TC table/detail (unchanged); 'generating' = bulk progress;
  // 'review' = one plan at a time with Approve/Reject + pagination. Approvals gate the Execution page.
  const [phase, setPhase]        = useState<'list' | 'generating' | 'review'>('list');
  const [reviewPlans, setRvPlans]= useState<Record<string, TcPlan | null>>({});
  const [reviews, setReviews]    = useState<Record<string, TcReview>>(() => api.getTcReviews());
  const [cur, setCur]            = useState(0);
  const [gen, setGen]            = useState<{ done: number; total: number; current: string; label: string }>(
    { done: 0, total: 0, current: '', label: '' });
  const cancelGenRef             = useRef(false);
  const [busyId, setBusyId]      = useState('');       // a single plan being regenerated
  const [rejecting, setRejecting]= useState(false);    // current-plan reject reason input open
  const [rejReason, setRejReason]= useState('');
  const [rejectAllOpen, setRejectAllOpen] = useState(false);
  const [rejectAllReason, setRejectAllReason] = useState('');
  // Review-phase plan editing (kept for parity with the list view's Edit; writes back to the cache).
  const [rvEditing, setRvEditing]= useState(false);
  const [rvSteps, setRvSteps]    = useState<TcPlanStep[]>([]);
  const [rvSaved, setRvSaved]    = useState(false);

  useEffect(() => {
    api.getConfig().then(c => {
      setHrTestPlan(!!c.human_review?.test_plan);
      setHrExplorer(!!c.human_review?.explorer);
    }).catch(() => {});
    try { setExplorerOk(localStorage.getItem('explorer_approved') === '1'); } catch { /* ignore */ }
  }, []);

  const load = () => api.getTestCases().then(cs => {
    setCases(cs);
    // keep the selected test case in sync with the latest DB content (e.g. after re-import)
    setSel(prev => prev ? (cs.find(c => c.test_id === prev.test_id) ?? prev) : prev);
  });
  useEffect(() => { load(); }, []);
  useEffect(() => { api.saveSelectedTcs(Array.from(checked)); }, [checked]);
  // Annotated exploration screenshots (screen_id → filenames) — attached as per-step thumbnails in the plan.
  useEffect(() => { api.getAnnotatedScreenshots().then(setAnnShots).catch(() => setAnnShots({})); }, []);
  // Newest annotated frame for a screen (filenames sort lexicographically with a trailing timestamp).
  const shotFor = (screenId?: string): string | undefined => {
    if (!screenId) return undefined;
    const list = annShots[screenId];
    return list && list.length ? [...list].sort().slice(-1)[0] : undefined;
  };

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

  // Fetch or load plan for a test case. `feedback` (human_review_test_plan reject reason) steers a regenerate.
  const fetchPlan = async (tc: TestCase, force = false, feedback = '') => {
    setPlan(null); setPlanSt('loading'); setPlanErr(''); setPlanEd(false);
    setPlanApproved(false); setPlanRejecting(false); setPlanReason('');

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
        ...(feedback ? { review_feedback: feedback } : {}),
      });
      saveCachedPlan(tc.test_id, p, tc);
      setPlan(p); setPlanSt('ready');
    } catch (e) {
      setPlanSt('error');
      setPlanErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submitPlanReject = () => {
    if (selected && planReason.trim()) fetchPlan(selected, true, planReason.trim());
  };

  const selectTc = (tc: TestCase) => {
    setSel(tc); setPlanEd(false); setPlanSaved(false);
    const saved = api.getTcConfig(tc.test_id);
    if (saved) setTcConfigs(prev => ({ ...prev, [tc.test_id]: saved }));
    // Gate (human_review_explorer): don't generate a plan until the exploration is approved.
    if (hrExplorer && !explorerOk) { setPlan(null); setPlanSt('idle'); return; }
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

  // ── Review helpers ─────────────────────────────────────────────────────────────
  // Persist a review-map update AND keep the run selection (`selected_tcs`, via `checked`) in sync:
  // APPROVED plans (in test-case order) are exactly what the Execution page may run.
  const applyReviews = (next: Record<string, TcReview>) => {
    setReviews(next);
    api.saveTcReviews(next);
    const approvedOrder = cases.filter(c => next[c.test_id]?.status === 'approved').map(c => c.test_id);
    setChecked(new Set(approvedOrder));   // effect persists to selected_tcs
  };

  // Build the Claude plan for one TC (force=regenerate, feedback=reject reason folded into the prompt).
  const planFor = async (tc: TestCase, force: boolean, feedback: string): Promise<TcPlan | null> => {
    if (!force) {
      const cached = loadCachedPlan(tc.test_id, tc);
      if (cached) return cached;
    }
    try {
      const p = await api.getTcPlan({
        test_id: tc.test_id, summary: tc.summary,
        description: tc.description, steps_raw: tc.steps_raw,
        expected_results_raw: tc.expected_results_raw,
        ...(force ? { force: true } : {}),
        ...(feedback ? { review_feedback: feedback } : {}),
      });
      saveCachedPlan(tc.test_id, p, tc);
      return p;
    } catch { return null; }
  };

  // Bulk generate/regenerate plans for EVERY test case, with live progress, then enter the review phase.
  // force/feedback=regenerate all (used by "Reject All"): the reason steers Claude and reviews reset to pending.
  const generateAll = async (opts: { force?: boolean; feedback?: string; label?: string } = {}) => {
    const { force = false, feedback = '', label = 'Generating test plans with Claude' } = opts;
    if (cases.length === 0) return;
    cancelGenRef.current = false;
    setGen({ done: 0, total: cases.length, current: cases[0]?.test_id ?? '', label });
    setPhase('generating');
    const nextPlans: Record<string, TcPlan | null> = { ...reviewPlans };
    for (let i = 0; i < cases.length; i++) {
      if (cancelGenRef.current) break;
      const tc = cases[i];
      setGen({ done: i, total: cases.length, current: tc.test_id, label });
      nextPlans[tc.test_id] = await planFor(tc, force, feedback);
    }
    setRvPlans(nextPlans);
    setGen(g => ({ ...g, done: cases.length, current: '' }));
    if (cancelGenRef.current) { setPhase('list'); return; }
    // Reviews: a (re)generated plan needs (re)review → pending, UNLESS it was already approved on a
    // plain first-time generation (force/feedback wipe approvals since the plan content changed).
    const nextReviews: Record<string, TcReview> = {};
    for (const c of cases) {
      const prev = reviews[c.test_id];
      nextReviews[c.test_id] = (!force && !feedback && prev?.status === 'approved')
        ? prev : { status: 'pending' };
    }
    applyReviews(nextReviews);
    setCur(0); setRvEditing(false); setRejecting(false); setRejReason('');
    setPhase('review');
  };

  const goReview = (i: number) => {
    setCur(Math.max(0, Math.min(cases.length - 1, i)));
    setRvEditing(false); setRejecting(false); setRejReason('');
  };

  const approveCur = () => {
    const tc = cases[cur]; if (!tc) return;
    applyReviews({ ...reviews, [tc.test_id]: { status: 'approved' } });
  };

  // Reject the current plan: capture the reason, regenerate THIS plan via Claude with the reason folded
  // in, land back at 'pending' for re-review. The code-fixing of the plan is Claude's; we just re-ask.
  const rejectCur = async () => {
    const tc = cases[cur]; if (!tc || !rejReason.trim()) return;
    const reason = rejReason.trim();
    setBusyId(tc.test_id); setRejecting(false);
    const p = await planFor(tc, true, reason);
    setRvPlans(prev => ({ ...prev, [tc.test_id]: p }));
    applyReviews({ ...reviews, [tc.test_id]: { status: 'pending', reason } });
    setBusyId(''); setRejReason('');
  };

  const approveAll = () => {
    const next: Record<string, TcReview> = {};
    for (const c of cases) next[c.test_id] = { status: 'approved' };
    applyReviews(next);
  };

  const submitRejectAll = async () => {
    if (!rejectAllReason.trim()) return;
    const reason = rejectAllReason.trim();
    setRejectAllOpen(false); setRejectAllReason('');
    await generateAll({ force: true, feedback: reason, label: 'Regenerating all plans with your feedback' });
  };

  // Review-phase edit (parity with list view) — operates on the current plan, saves to cache + state.
  const curTc   = phase === 'review' ? cases[cur] : undefined;
  const curPlan = curTc ? reviewPlans[curTc.test_id] ?? null : null;
  const startRvEdit  = () => { if (curPlan) { setRvSteps(curPlan.steps.map(s => ({ ...s }))); setRvEditing(true); } };
  const saveRvEdit   = () => {
    if (!curPlan || !curTc) return;
    const updated = { ...curPlan, steps: rvSteps };
    saveCachedPlan(curTc.test_id, updated);
    setRvPlans(prev => ({ ...prev, [curTc.test_id]: updated }));
    setRvEditing(false); setRvSaved(true); setTimeout(() => setRvSaved(false), 2000);
  };
  const regenCur = async () => {
    if (!curTc) return;
    setBusyId(curTc.test_id);
    deleteCachedPlan(curTc.test_id);
    await api.deleteTcPlan(curTc.test_id).catch(() => {});
    const p = await planFor(curTc, true, '');
    setRvPlans(prev => ({ ...prev, [curTc.test_id]: p }));
    applyReviews({ ...reviews, [curTc.test_id]: { status: 'pending' } });
    setBusyId('');
  };
  const updateRvStep = (i: number, field: keyof TcPlanStep, val: string) =>
    setRvSteps(prev => prev.map((s, j) => j === i ? { ...s, [field]: val } : s));

  const reviewCounts = {
    approved: cases.filter(c => reviews[c.test_id]?.status === 'approved').length,
    pending:  cases.filter(c => !reviews[c.test_id] || reviews[c.test_id]?.status === 'pending').length,
    total:    cases.length,
  };
  const havePlans = cases.length > 0 && cases.some(c => reviewPlans[c.test_id] || loadCachedPlan(c.test_id, c));

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

  // ── PHASE: generating ──────────────────────────────────────────────────────────
  if (phase === 'generating') {
    const pct = gen.total ? Math.round((gen.done / gen.total) * 100) : 0;
    return (
      <div>
        <div className="card section">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{gen.label}…</div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Claude is generating an execution plan for each test case. You can review them as soon as this finishes.
          </p>
          <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.3s ease' }} />
          </div>
          <div className="row" style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text)' }}>
              {gen.done} / {gen.total} plans
              {gen.current && <span style={{ color: 'var(--muted)' }}> · generating <code className="text-accent">{gen.current}</code></span>}
            </span>
            <span className="spacer" />
            <button className="btn btn-secondary btn-sm" onClick={() => { cancelGenRef.current = true; }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── PHASE: review ──────────────────────────────────────────────────────────────
  if (phase === 'review' && curTc) {
    const rvStatus = reviews[curTc.test_id]?.status ?? 'pending';
    const rvReason = reviews[curTc.test_id]?.reason;
    const busy     = busyId === curTc.test_id;
    const rvCred   = (curPlan?.required_config ?? []).filter(f => f && f.key).map(f => ({ ...f, label: f.label || f.key }));
    const rvCfg    = tcConfigs[curTc.test_id] || api.getTcConfig(curTc.test_id) || {};
    const statusOf = (i: number) => (reviews[cases[i]?.test_id]?.status ?? 'pending') as 'approved' | 'rejected' | 'pending';
    const badge = rvStatus === 'approved'
      ? <span className="badge badge-green">✓ Approved</span>
      : <span className="badge badge-yellow">⏳ Pending review</span>;

    return (
      <div>
        {/* Top bar — Approve All / Reject All + progress */}
        <div className="card section">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Review Test Plans</div>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {reviewCounts.approved} approved · {reviewCounts.pending} pending of {reviewCounts.total}.
                Only <strong>approved</strong> plans run on the Execution page.
              </p>
            </div>
            <span className="spacer" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPhase('list')}>← Back to list</button>
              <button className="btn btn-primary btn-sm" onClick={approveAll}>✓ Approve All</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setRejectAllOpen(o => !o)}>✕ Reject All</button>
              {reviewCounts.approved > 0 && (
                <button className="btn btn-primary btn-sm" onClick={() => onNav('execution')}>Proceed to Execution →</button>
              )}
            </div>
          </div>
          {rejectAllOpen && (
            <div className="card card-sm" style={{ marginTop: 10, borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reject all — reason for Claude</div>
              <textarea value={rejectAllReason} onChange={e => setRejectAllReason(e.target.value)} rows={3}
                placeholder="What should Claude change across ALL plans? This is folded into the regeneration of every test case."
                style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn btn-danger btn-sm" onClick={submitRejectAll} disabled={!rejectAllReason.trim()}>Reject all &amp; regenerate</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setRejectAllOpen(false); setRejectAllReason(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Top pager */}
        <div className="card section" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <Pager cur={cur} total={cases.length} go={goReview} statusOf={statusOf} />
        </div>

        <div className="grid-2">
          {/* LEFT — the generated plan + its raw test case below */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <div>
                <code className="text-accent" style={{ fontSize: 12 }}>{curTc.test_id}</code>
                <span style={{ marginLeft: 8 }}>{badge}</span>
                <div style={{ fontWeight: 600, marginTop: 3 }}>{curTc.summary}</div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>Plan {cur + 1} of {cases.length}</div>
              </div>
              <span className="spacer" />
              <div className="row" style={{ gap: 6 }}>
                {rvSaved && <span style={{ fontSize: 10, color: 'var(--green)' }}>✓ saved!</span>}
                {curPlan && !rvEditing && !busy && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={startRvEdit} style={{ fontSize: 11 }}>✏ Edit</button>
                    <button className="btn btn-secondary btn-sm" onClick={regenCur} style={{ fontSize: 11 }} title="Regenerate via Claude">↺ Regenerate</button>
                  </>
                )}
                {rvEditing && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={saveRvEdit} style={{ fontSize: 11 }}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setRvEditing(false)} style={{ fontSize: 11 }}>Cancel</button>
                  </>
                )}
              </div>
            </div>

            <div className="form-label">Execution Plan</div>
            {busy ? (
              <div style={{ padding: '12px 0' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>⏳ Regenerating plan with Claude…</div>
                <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--accent)', animation: 'explore-progress 1.5s ease-in-out infinite', width: '35%' }} />
                </div>
              </div>
            ) : !curPlan ? (
              <div style={{ padding: '10px 12px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--red)' }}>✗ No plan generated for this test case.</span>
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={regenCur}>Generate</button>
              </div>
            ) : rvEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {rvSteps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 20 }}>{i + 1}.</span>
                    <input value={s.description} onChange={e => updateRvStep(i, 'description', e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12 }} />
                    <select value={s.channel} onChange={e => updateRvStep(i, 'channel', e.target.value as TcPlanStep['channel'])}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 11, padding: '2px 4px' }}>
                      <option value="robot">🤖 robot</option><option value="web">🌐 web</option>
                      <option value="db">🗄 db</option><option value="validation">✓ validate</option>
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {curPlan.steps.map((s, i) => <PlanStep key={i} step={s} idx={i} shotFor={shotFor} />)}
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
              🤖 robot = kiosk touchscreen tap/type · 🌐 web = external app · 🗄 db = database check · ✓ validate = assertion
            </p>

            {/* Required inputs for this TC (unchanged behaviour) */}
            {rvCred.length > 0 && (
              <div className="form-group" style={{ marginTop: 8 }}>
                <div className="form-label">Required Test Inputs <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— stored in browser</span></div>
                <div className="card card-sm">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {rvCred.map(f => (
                      <div key={f.key}>
                        <label className="form-label">{f.label}</label>
                        <input className="form-input" type={f.type === 'password' ? 'password' : 'text'}
                          value={rvCfg[f.key] || ''} onChange={e => saveCfg(curTc.test_id, f.key, e.target.value)}
                          placeholder={`Enter ${f.label.toLowerCase()}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Raw test case below the plan */}
            <div className="form-group" style={{ marginTop: 8 }}>
              <div className="form-label">Description</div>
              <div className="raw-box">{curTc.description || '—'}</div>
            </div>
            <div className="form-group">
              <div className="form-label">Raw Steps</div>
              <div className="raw-box">{curTc.steps_raw || '—'}</div>
            </div>
            <div className="form-group">
              <div className="form-label">Expected Results</div>
              <div className="raw-box">{curTc.expected_results_raw || '—'}</div>
            </div>

            {/* Bottom pager under each plan */}
            <div style={{ marginTop: 6 }}>
              <Pager cur={cur} total={cases.length} go={goReview} statusOf={statusOf} />
            </div>
          </div>

          {/* RIGHT — Review (approve / reject) */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Review</div>
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Approve to make this test case runnable, or reject with a reason — Claude regenerates this plan using your feedback.
            </p>

            <div className="card card-sm" style={{
              borderColor: rvStatus === 'approved' ? 'rgba(34,197,94,0.4)' : 'rgba(234,179,8,0.35)',
              background: rvStatus === 'approved' ? 'rgba(34,197,94,0.06)' : 'rgba(234,179,8,0.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                Status: {badge}
              </div>
              {rvReason && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  Last reject reason fed to Claude: <em>“{rvReason}”</em>
                </div>
              )}
              {!rejecting ? (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={approveCur} disabled={busy || rvStatus === 'approved' || !curPlan}>✓ Approve</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setRejecting(true); setRejReason(rvReason || ''); }} disabled={busy || !curPlan}>✕ Reject</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea value={rejReason} onChange={e => setRejReason(e.target.value)} rows={4}
                    placeholder="What's wrong with this plan? Claude uses this when regenerating THIS test case."
                    style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-danger btn-sm" onClick={rejectCur} disabled={!rejReason.trim()}>Submit reject &amp; regenerate</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setRejecting(false); setRejReason(''); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => goReview(cur - 1)} disabled={cur === 0}>‹ Previous</button>
              <button className="btn btn-secondary btn-sm" onClick={() => goReview(cur + 1)} disabled={cur === cases.length - 1}>Next ›</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── PHASE: list (classic) ────────────────────────────────────────────────────────
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

      {/* Bulk plan generation + review entry */}
      {cases.length > 0 && (
        <div className="card section" style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.05)' }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Generate &amp; review test plans</div>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                Generate a Claude execution plan for all {cases.length} test case{cases.length > 1 ? 's' : ''} at once, then
                approve or reject each one. Only approved plans run on the Execution page.
                {reviewCounts.approved > 0 && <> · <strong>{reviewCounts.approved} approved</strong> so far.</>}
              </p>
            </div>
            <span className="spacer" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => generateAll()}>
                ⚙ Generate Test Plans ({cases.length})
              </button>
              {havePlans && (
                <button className="btn btn-secondary btn-sm" onClick={() => {
                  // Enter review using already-cached plans without re-calling Claude.
                  const loaded: Record<string, TcPlan | null> = {};
                  const nextReviews = { ...reviews };
                  for (const c of cases) {
                    loaded[c.test_id] = reviewPlans[c.test_id] ?? loadCachedPlan(c.test_id, c);
                    if (!nextReviews[c.test_id]) nextReviews[c.test_id] = { status: 'pending' };
                  }
                  setRvPlans(loaded); applyReviews(nextReviews); setCur(0); setPhase('review');
                }}>
                  Review plans →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

                {/* Gate: exploration must be approved first (human_review_explorer) */}
                {hrExplorer && !explorerOk && (
                  <div className="card card-sm" style={{ borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>⏸ Approve the exploration first</div>
                    <p className="text-muted" style={{ fontSize: 12 }}>
                      Human review is on for App Explorer. Approve the latest exploration on the
                      <strong> App Explorer</strong> page before generating test plans.
                    </p>
                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => onNav('explorer')}>Go to App Explorer →</button>
                  </div>
                )}

                {/* View mode */}
                {planStatus === 'ready' && plan && !planEditing && (!hrExplorer || explorerOk) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {plan.steps.map((s, i) => <PlanStep key={i} step={s} idx={i} shotFor={shotFor} />)}
                  </div>
                )}

                {/* Test-plan human review (human_review_test_plan) */}
                {planStatus === 'ready' && plan && !planEditing && hrTestPlan && !planApproved && (!hrExplorer || explorerOk) && (
                  <div className="card card-sm" style={{ marginTop: 8, borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>⏸ Review this test plan</div>
                    {!planRejecting ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setPlanApproved(true)}>✓ Approve plan</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setPlanRejecting(true)}>✕ Reject</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <textarea value={planReason} onChange={e => setPlanReason(e.target.value)} rows={3}
                          placeholder="What's wrong with this plan? It's applied when the plan regenerates."
                          style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-danger btn-sm" onClick={submitPlanReject} disabled={!planReason.trim()}>Submit reject &amp; regenerate</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setPlanRejecting(false); setPlanReason(''); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {planStatus === 'ready' && plan && hrTestPlan && planApproved && (
                  <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 6 }}>✓ Plan approved</div>
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

                {planStatus === 'idle' && (!hrExplorer || explorerOk) && (
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
