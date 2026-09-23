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

// ── Plan viewer ─────────────────────────────────────────────────────────────────

// A click/type step points at a concrete UI element — show the annotated exploration screenshot of that
// screen (the same labelled frame the explorer produced) as a thumbnail; click to enlarge.
function isInteractionStep(step: TcPlanStep): boolean {
  const a = (step.action || '').toLowerCase();
  return /tap|click|type|press|select|enter/.test(a) || (step.px != null && step.py != null) || !!step.element_id;
}

function PlanStep({ step, idx, shotFor }: { step: TcPlanStep; idx: number; shotFor?: (screenId?: string) => string | undefined }) {
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
// Flow: import test cases → "Generate Test Plans" (all at once, progress shown inline) → REVIEW one plan
// at a time (Approve / Reject-with-reason). Reject only QUEUES the case into a rejected list; a separate
// "Rejected plans" window batch-regenerates the selected ones with their reasons. Only APPROVED plans run
// on the Execution page. (The old per-test selection table + inline generate/edit flow was removed.)

export default function TestIntake({ onNav }: { onNav: (p: string) => void }) {
  const [cases,      setCases]    = useState<TestCase[]>([]);
  const [checked,    setChecked]  = useState<Set<string>>(() => new Set(api.getSelectedTcs()));
  const [uploading,  setUploading]= useState(false);
  const [uploadMsg,  setUploadMsg]= useState('');
  const [tcConfigs,  setTcConfigs]= useState<Record<string, TcConfig>>({});
  const [annShots,   setAnnShots] = useState<Record<string, string[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Explorer-approval gate (human_review_explorer): don't allow plan generation until exploration is approved.
  const [hrExplorer, setHrExplorer]= useState(false);
  const [explorerOk, setExplorerOk]= useState(true);

  // Bulk generation + review state
  const [phase, setPhase]        = useState<'setup' | 'review'>('setup');
  const [generating, setGen8]    = useState(false);
  const [reviewPlans, setRvPlans]= useState<Record<string, TcPlan | null>>({});
  const [reviews, setReviews]    = useState<Record<string, TcReview>>(() => api.getTcReviews());
  const [cur, setCur]            = useState(0);
  const [gen, setGen]            = useState<{ done: number; total: number; current: string; label: string }>(
    { done: 0, total: 0, current: '', label: '' });
  const cancelGenRef             = useRef(false);
  const [rejecting, setRejecting]= useState(false);    // current-plan reject reason input open
  const [rejReason, setRejReason]= useState('');
  const [rejectAllOpen, setRejectAllOpen] = useState(false);
  const [rejectAllReason, setRejectAllReason] = useState('');
  // Rejected-plans window
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [rejSel, setRejSel]      = useState<Set<string>>(new Set());
  const [regenBusy, setRegenBusy]= useState(false);

  useEffect(() => {
    api.getConfig().then(c => setHrExplorer(!!c.human_review?.explorer)).catch(() => {});
    try { setExplorerOk(localStorage.getItem('explorer_approved') === '1'); } catch { /* ignore */ }
  }, []);

  const load = () => api.getTestCases().then(setCases);
  useEffect(() => { load(); }, []);
  useEffect(() => { api.saveSelectedTcs(Array.from(checked)); }, [checked]);
  // Annotated exploration screenshots (screen_id → filenames) — shown as per-step thumbnails + on the review side.
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

  const saveCfg = (test_id: string, key: string, val: string) => {
    const cfg = { ...(tcConfigs[test_id] || {}), [key]: val };
    setTcConfigs(prev => ({ ...prev, [test_id]: cfg }));
    api.saveTcConfig(test_id, cfg);         // auto-save on every keystroke
  };

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

  // Bulk-generate a plan for EVERY test case, with inline progress, then enter the review phase.
  const generateAll = async () => {
    if (cases.length === 0 || (hrExplorer && !explorerOk)) return;
    cancelGenRef.current = false;
    setGen8(true);
    setGen({ done: 0, total: cases.length, current: cases[0]?.test_id ?? '', label: 'Generating test plans with Claude' });
    const nextPlans: Record<string, TcPlan | null> = { ...reviewPlans };
    for (let i = 0; i < cases.length; i++) {
      if (cancelGenRef.current) break;
      const tc = cases[i];
      setGen({ done: i, total: cases.length, current: tc.test_id, label: 'Generating test plans with Claude' });
      nextPlans[tc.test_id] = await planFor(tc, false, '');
    }
    setRvPlans(nextPlans);
    setGen(g => ({ ...g, done: cases.length, current: '' }));
    setGen8(false);
    if (cancelGenRef.current) return;   // stay on the setup page
    // Freshly generated plans need review → pending, unless already approved (a re-run over cached plans).
    const nextReviews: Record<string, TcReview> = {};
    for (const c of cases) {
      const prev = reviews[c.test_id];
      nextReviews[c.test_id] = prev?.status === 'approved' ? prev : { status: 'pending' };
    }
    applyReviews(nextReviews);
    setCur(0); setRejecting(false); setRejReason(''); setPhase('review');
  };

  // Enter review with already-cached plans (no Claude calls).
  const openReview = () => {
    const loaded: Record<string, TcPlan | null> = {};
    const nextReviews = { ...reviews };
    for (const c of cases) {
      loaded[c.test_id] = reviewPlans[c.test_id] ?? loadCachedPlan(c.test_id, c);
      if (!nextReviews[c.test_id]) nextReviews[c.test_id] = { status: 'pending' };
    }
    setRvPlans(loaded); applyReviews(nextReviews); setCur(0); setPhase('review');
  };

  const goReview = (i: number) => {
    setCur(Math.max(0, Math.min(cases.length - 1, i)));
    setRejecting(false); setRejReason('');
  };

  const approveCur = () => {
    const tc = cases[cur]; if (!tc) return;
    applyReviews({ ...reviews, [tc.test_id]: { status: 'approved' } });
  };

  // Reject the current plan: just QUEUE it (status 'rejected' + reason). No regeneration here — the
  // rejected list is regenerated later, in batch, from the "Rejected plans" window.
  const rejectCur = () => {
    const tc = cases[cur]; if (!tc || !rejReason.trim()) return;
    applyReviews({ ...reviews, [tc.test_id]: { status: 'rejected', reason: rejReason.trim() } });
    setRejecting(false); setRejReason('');
  };

  const approveAll = () => {
    const next: Record<string, TcReview> = {};
    for (const c of cases) next[c.test_id] = { status: 'approved' };
    applyReviews(next);
  };

  // Reject All: queue EVERY case as rejected with one reason (still no immediate regeneration).
  const submitRejectAll = () => {
    if (!rejectAllReason.trim()) return;
    const reason = rejectAllReason.trim();
    const next: Record<string, TcReview> = {};
    for (const c of cases) next[c.test_id] = { status: 'rejected', reason };
    applyReviews(next);
    setRejectAllOpen(false); setRejectAllReason('');
  };

  // Batch-regenerate the chosen rejected plans, each with its own stored reason folded into Claude's
  // prompt. Regenerated plans land back at 'pending' for re-review. Runs from the Rejected-plans window.
  const regenerateSelected = async (ids: string[]) => {
    if (!ids.length) return;
    setRegenBusy(true);
    setGen({ done: 0, total: ids.length, current: '', label: 'Regenerating rejected plans with your feedback' });
    const nextPlans = { ...reviewPlans };
    const nextReviews = { ...reviews };
    for (let i = 0; i < ids.length; i++) {
      const tc = cases.find(c => c.test_id === ids[i]);
      if (!tc) continue;
      setGen({ done: i, total: ids.length, current: tc.test_id, label: 'Regenerating rejected plans with your feedback' });
      const reason = reviews[tc.test_id]?.reason || '';
      deleteCachedPlan(tc.test_id);
      await api.deleteTcPlan(tc.test_id).catch(() => {});
      nextPlans[tc.test_id] = await planFor(tc, true, reason);
      nextReviews[tc.test_id] = { status: 'pending' };
    }
    setRvPlans(nextPlans);
    applyReviews(nextReviews);
    setGen(g => ({ ...g, done: ids.length, current: '' }));
    setRegenBusy(false); setRejectedOpen(false); setRejSel(new Set());
    // Land the reviewer on the first regenerated plan.
    const firstIdx = cases.findIndex(c => ids.includes(c.test_id));
    if (firstIdx >= 0) setCur(firstIdx);
  };

  const curTc   = phase === 'review' ? cases[cur] : undefined;
  const curPlan = curTc ? reviewPlans[curTc.test_id] ?? null : null;

  const rejectedList = cases.filter(c => reviews[c.test_id]?.status === 'rejected');
  const reviewCounts = {
    approved: cases.filter(c => reviews[c.test_id]?.status === 'approved').length,
    rejected: rejectedList.length,
    pending:  cases.filter(c => { const s = reviews[c.test_id]?.status; return !s || s === 'pending'; }).length,
    total:    cases.length,
  };
  const havePlans = cases.length > 0 && cases.some(c => reviewPlans[c.test_id] || loadCachedPlan(c.test_id, c));

  // ── REVIEW phase ────────────────────────────────────────────────────────────────
  if (phase === 'review' && curTc) {
    const rvStatus = reviews[curTc.test_id]?.status ?? 'pending';
    const rvReason = reviews[curTc.test_id]?.reason;
    const rvCred   = (curPlan?.required_config ?? []).filter(f => f && f.key).map(f => ({ ...f, label: f.label || f.key }));
    const rvCfg    = tcConfigs[curTc.test_id] || api.getTcConfig(curTc.test_id) || {};
    const statusOf = (i: number) => (reviews[cases[i]?.test_id]?.status ?? 'pending') as 'approved' | 'rejected' | 'pending';
    const badge = rvStatus === 'approved'
      ? <span className="badge badge-green">✓ Approved</span>
      : rvStatus === 'rejected'
      ? <span className="badge badge-red">✕ Rejected (queued)</span>
      : <span className="badge badge-yellow">⏳ Pending review</span>;
    // Steps whose annotated screenshot we can show on the review side.
    const shotSteps = (curPlan?.steps ?? []).map((s, i) => ({ s, i, shot: isInteractionStep(s) ? shotFor(s.screen_id) : undefined }))
      .filter(x => !!x.shot);

    return (
      <div>
        {/* Top bar — Approve All / Reject All / Rejected window + progress */}
        <div className="card section">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Review Test Plans</div>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {reviewCounts.approved} approved · {reviewCounts.rejected} rejected · {reviewCounts.pending} pending of {reviewCounts.total}.
                Only <strong>approved</strong> plans run on the Execution page.
              </p>
            </div>
            <span className="spacer" />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPhase('setup')}>← Back</button>
              <button className="btn btn-primary btn-sm" onClick={approveAll}>✓ Approve All</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setRejectAllOpen(o => !o)}>✕ Reject All</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setRejSel(new Set(rejectedList.map(c => c.test_id))); setRejectedOpen(true); }}
                disabled={reviewCounts.rejected === 0}
                title="Review rejected plans and regenerate them with Claude">
                🗂 Rejected plans ({reviewCounts.rejected})
              </button>
              {reviewCounts.approved > 0 && (
                <button className="btn btn-primary btn-sm" onClick={() => onNav('execution')}>Proceed to Execution →</button>
              )}
            </div>
          </div>
          {rejectAllOpen && (
            <div className="card card-sm" style={{ marginTop: 10, borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reject all — reason for Claude</div>
              <textarea value={rejectAllReason} onChange={e => setRejectAllReason(e.target.value)} rows={3}
                placeholder="Why reject all plans? Stored with every case; applied when you regenerate from the Rejected plans window."
                style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn btn-danger btn-sm" onClick={submitRejectAll} disabled={!rejectAllReason.trim()}>Reject all &amp; queue</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setRejectAllOpen(false); setRejectAllReason(''); }}>Cancel</button>
              </div>
            </div>
          )}
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
            </div>

            <div className="form-label">Execution Plan</div>
            {!curPlan ? (
              <div style={{ padding: '10px 12px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--red)' }}>✗ No plan generated for this test case.</span>
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={() => regenerateSelected([curTc.test_id])} disabled={regenBusy}>Generate</button>
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

          {/* RIGHT — Review (approve / reject) + per-step annotated screenshots */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Review</div>
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Approve to make this test case runnable, or reject with a reason (it's queued — regenerate rejected plans in batch from the Rejected plans window).
            </p>

            <div className="card card-sm" style={{
              borderColor: rvStatus === 'approved' ? 'rgba(34,197,94,0.4)' : rvStatus === 'rejected' ? 'rgba(239,68,68,0.4)' : 'rgba(234,179,8,0.35)',
              background: rvStatus === 'approved' ? 'rgba(34,197,94,0.06)' : rvStatus === 'rejected' ? 'rgba(239,68,68,0.05)' : 'rgba(234,179,8,0.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>Status: {badge}</div>
              {rvReason && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  Reject reason (saved for Claude): <em>“{rvReason}”</em>
                </div>
              )}
              {!rejecting ? (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={approveCur} disabled={rvStatus === 'approved' || !curPlan}>✓ Approve</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setRejecting(true); setRejReason(rvReason || ''); }} disabled={!curPlan}>✕ Reject</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea value={rejReason} onChange={e => setRejReason(e.target.value)} rows={4}
                    placeholder="What's wrong with this plan? Saved and applied when you regenerate rejected plans."
                    style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-danger btn-sm" onClick={rejectCur} disabled={!rejReason.trim()}>Reject &amp; queue</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setRejecting(false); setRejReason(''); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => goReview(cur - 1)} disabled={cur === 0}>‹ Previous</button>
              <button className="btn btn-secondary btn-sm" onClick={() => goReview(cur + 1)} disabled={cur === cases.length - 1}>Next ›</button>
            </div>

            {/* Per-step annotated screenshots — so coordinates can be verified without opening each one */}
            <div className="form-label">Step Screenshots (annotated)</div>
            {shotSteps.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 12 }}>
                No annotated screenshots for this plan's steps yet — run the App Explorer to capture them.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 620, overflowY: 'auto' }}>
                {shotSteps.map(({ s, i, shot }) => (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg)' }}>
                    <div style={{ fontSize: 11, padding: '5px 8px', background: 'var(--surface2)', color: 'var(--text)', lineHeight: 1.5 }}>
                      <strong>{i + 1}.</strong> {s.description}
                      {s.px != null && s.py != null && (
                        <span style={{ marginLeft: 6, color: 'var(--muted)', fontFamily: 'monospace' }}>
                          [{s.screen_id} · {s.element_id} · ({s.px},{s.py})]
                        </span>
                      )}
                    </div>
                    <img src={annotatedScreenshotUrl(shot!)} alt={`${s.screen_id} annotated`}
                      style={{ width: '100%', display: 'block', background: '#000' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rejected-plans window */}
        {rejectedOpen && (
          <RejectedWindow
            rejected={rejectedList}
            reviews={reviews}
            selected={rejSel}
            setSelected={setRejSel}
            busy={regenBusy}
            progress={regenBusy ? gen : null}
            onRegenerate={() => regenerateSelected([...rejSel])}
            onClose={() => { if (!regenBusy) setRejectedOpen(false); }}
          />
        )}
      </div>
    );
  }

  // ── SETUP phase (import + generate; progress shown inline) ─────────────────────────
  const blockedByExplorer = hrExplorer && !explorerOk;
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

      {/* Import */}
      <div className="card section">
        <label className="form-label">Import Test Cases (.xlsx)</label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? '⏳ Uploading…' : '📁 Choose File'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={upload} />
          {uploadMsg && <span style={{ fontSize: 12, color: uploadMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{uploadMsg}</span>}
        </div>
      </div>

      {/* Generate & review */}
      <div className="card section" style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.05)' }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="section-title" style={{ marginBottom: 0 }}>Test Plans ({cases.length})</span>
        </div>

        {cases.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 12 }}>No test cases yet. Import an Excel file to begin.</p>
        ) : blockedByExplorer ? (
          <div className="card card-sm" style={{ borderColor: 'var(--yellow)', background: 'rgba(234,179,8,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>⏸ Approve the exploration first</div>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Human review is on for App Explorer. Approve the latest exploration on the <strong>App Explorer</strong> page
              before generating test plans.
            </p>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => onNav('explorer')}>Go to App Explorer →</button>
          </div>
        ) : generating ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{gen.label}…</div>
            <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${gen.total ? Math.round((gen.done / gen.total) * 100) : 0}%`, background: 'var(--accent)', transition: 'width 0.3s ease' }} />
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
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5, flex: 1, minWidth: 240 }}>
              Generate a Claude execution plan for all {cases.length} test case{cases.length > 1 ? 's' : ''} at once, then
              approve or reject each one. Only approved plans run on the Execution page.
              {reviewCounts.approved > 0 && <> · <strong>{reviewCounts.approved} approved</strong> so far.</>}
            </p>
            <span className="spacer" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={generateAll}>⚙ Generate Test Plans ({cases.length})</button>
              {havePlans && <button className="btn btn-secondary btn-sm" onClick={openReview}>Review plans →</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rejected-plans window ────────────────────────────────────────────────────────
// A floating table of rejected plans + their reasons. Select all / individual, then regenerate.
function RejectedWindow({ rejected, reviews, selected, setSelected, busy, progress, onRegenerate, onClose }: {
  rejected: TestCase[];
  reviews: Record<string, TcReview>;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  busy: boolean;
  progress: { done: number; total: number; current: string; label: string } | null;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  const allSel = rejected.length > 0 && rejected.every(c => selected.has(c.test_id));
  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(rejected.map(c => c.test_id)));

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} className="card"
        style={{ width: 'min(920px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <div style={{ fontWeight: 700, fontSize: 15 }}>Rejected Test Plans ({rejected.length})</div>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>✕ Close</button>
        </div>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Select the plans to regenerate — each is re-planned by Claude using its saved rejection reason, then returned to
          <strong> pending</strong> for re-review.
        </p>

        {busy && progress && (
          <div className="card card-sm">
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{progress.label}…</div>
            <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`, background: 'var(--accent)', transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)' }}>
              {progress.done} / {progress.total}
              {progress.current && <span style={{ color: 'var(--muted)' }}> · <code className="text-accent">{progress.current}</code></span>}
            </div>
          </div>
        )}

        <div className="table-wrap" style={{ overflowY: 'auto', flex: 1 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" checked={allSel} onChange={toggleAll} disabled={busy}
                    style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 15, height: 15 }} />
                </th>
                <th>ID</th><th>Summary</th><th>Rejection reason</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map(tc => (
                <tr key={tc.test_id}>
                  <td style={{ paddingLeft: 12 }}>
                    <input type="checkbox" checked={selected.has(tc.test_id)} onChange={() => toggle(tc.test_id)} disabled={busy}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 14, height: 14 }} />
                  </td>
                  <td className="monospace" style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--accent2)' }}>{tc.test_id}</td>
                  <td style={{ fontSize: 12 }}>{tc.summary}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{reviews[tc.test_id]?.reason || <em>— none —</em>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>{selected.size} selected</span>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={onRegenerate} disabled={busy || selected.size === 0}>
            {busy ? '⏳ Regenerating…' : `↺ Regenerate selected (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
