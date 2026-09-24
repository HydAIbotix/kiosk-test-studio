import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { api, runScreenshotUrl, runWs } from '../api/client';
import type { RepairJob, RepairStage } from '../api/client';

/** The self-healing arm of defect intelligence. Repairs run AUTOMATICALLY: whenever a test
 *  fails, the backend fires the Auto-Repair agent — RAG retrieves the offending code, the model
 *  proposes one minimal patch, the agent applies it, type-checks, builds, and opens a PR. The
 *  retrieval and diagnose tools are shown per stage from what actually ran (e.g. GraphRAG + Neo4j
 *  and a local Llama when the in-house stack is selected). This page is a live DASHBOARD of those
 *  repairs (no manual trigger — the run that fails is the trigger). The standalone window popped by
 *  Live Monitor reuses the same pipeline view for a single repair. */

type StageMeta = { key: string; icon: string; label: string; sub: string; agent: 'rca' | 'fix' };
// Two SEPARATE agents: the RCA agent decides code vs spec/test bug (and can STOP), then the code-fixing
// agent retrieves code, patches, tests, builds and opens a PR. `sub` is a fallback shown before a repair
// reports its tool; the live stage's `tool` (streamed from the backend) overrides it.
const STAGES: StageMeta[] = [
  { key: 'rca',      icon: '🕵️', label: 'Root-cause analysis', sub: 'reads docs + test case — spec/test vs code', agent: 'rca' },
  { key: 'retrieve', icon: '🔎', label: 'Retrieve code',       sub: 'code-only vector RAG', agent: 'fix' },
  { key: 'diagnose', icon: '🧠', label: 'Diagnose the bug',    sub: 'LLM diagnosis', agent: 'fix' },
  { key: 'apply',    icon: '🩹', label: 'Apply the fix',       sub: 'single-occurrence patch', agent: 'fix' },
  { key: 'test',     icon: '🧪', label: 'Unit test',           sub: 'TypeScript type-check', agent: 'fix' },
  { key: 'build',    icon: '🏗️', label: 'Build',               sub: 'tsc -b + vite build', agent: 'fix' },
  { key: 'retest',   icon: '🔁', label: 'Re-test the fix',     sub: 're-runs the failed test to verify', agent: 'fix' },
  { key: 'pr',       icon: '🔀', label: 'Raise PR',            sub: 'branch + commit + diff', agent: 'fix' },
];

const AGENT_META: Record<'rca' | 'fix', { num: string; name: string; blurb: string }> = {
  rca: { num: '①', name: 'RCA Agent', blurb: 'reads the design docs + test case, decides code bug vs spec/test bug' },
  fix: { num: '②', name: 'Code-Fixing Agent', blurb: 'retrieves code, patches the bug, type-checks, builds and opens a PR' },
};

type StatusKind = 'pending' | 'running' | 'done' | 'warn' | 'failed';

function statusOf(stage: RepairStage | undefined, isActiveGuess: boolean): StatusKind {
  if (!stage) return isActiveGuess ? 'running' : 'pending';
  const s = stage.status;
  if (s === 'running') return 'running';
  if (s === 'failed') return 'failed';
  if (s === 'warn') return 'warn';
  if (s === 'done') return 'done';
  return 'pending';
}

const DOT: Record<StatusKind, { glyph: string; color: string; ring: string }> = {
  pending: { glyph: '○', color: 'var(--muted)',  ring: 'var(--border)' },
  running: { glyph: '◐', color: 'var(--accent2)', ring: 'var(--accent)' },
  done:    { glyph: '✓', color: 'var(--green)',  ring: 'var(--green)' },
  warn:    { glyph: '!', color: 'var(--yellow)', ring: 'var(--yellow)' },
  failed:  { glyph: '✕', color: 'var(--red)',    ring: 'var(--red)' },
};

// A clearly-legible monospace stack for the code/output boxes (bare `monospace` renders faint/thin on
// some platforms). Paired with an explicit text colour so the text is always visible on the dark boxes.
const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Code', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, monospace";

function mergedStages(job: RepairJob | null): Record<string, RepairStage> {
  if (!job) return {};
  return { ...(job.stages || {}), ...(job.result?.stages || {}) };
}

// The 'retest' stage exists only when the fix-verification re-run actually ran (repair_retest_before_pr
// on + a green build). When it didn't, drop that row so the pipeline reads exactly as before (no phantom
// "pending" retest step stuck between Build and Raise PR).
function visibleStages(stages: Record<string, RepairStage>): StageMeta[] {
  return STAGES.filter(s => s.key !== 'retest' || !!stages['retest']);
}

function relTime(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type IndexState = { building: boolean; exists: boolean; message: string } | null;

export default function AutoRepair({ standaloneRepairId }: { standaloneRepairId?: string } = {}) {
  const [jobs,  setJobs]  = useState<RepairJob[]>([]);
  const [error, setError] = useState('');
  const [index, setIndex] = useState<IndexState>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<number | undefined>(undefined);

  const refreshIndex = useCallback(async () => {
    try {
      const s = await api.getRepairIndex();
      setIndex(s);
      // Self-heal the badge: whenever the backend is no longer building, clear the local busy flag.
      // The rebuild loop can miss the building→done transition (a race, or a graphrag build whose
      // "exists" only flips once Neo4j is populated), which otherwise left the badge stuck on "building".
      if (!s.building) setIndexBusy(false);
    } catch { /* backend down */ }
  }, []);

  // Data source: a single job in the standalone window, else the full dashboard list.
  const refresh = useCallback(async () => {
    try {
      if (standaloneRepairId) {
        setJobs([await api.getRepair(standaloneRepairId)]);
      } else {
        setJobs(await api.listRepairs());
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load repairs');
    }
  }, [standaloneRepairId]);

  useEffect(() => {
    refreshIndex();
    refresh();
    // Poll continuously: new auto-triggered repairs arrive here, and running ones stream stages.
    // Index status is polled too so the RAG-index badge always reflects the backend (and never sticks
    // on "building" after a build finishes), independent of the one-shot rebuild loop.
    pollRef.current = window.setInterval(() => { refresh(); refreshIndex(); }, 2500);
    return () => clearInterval(pollRef.current);
  }, [refresh, refreshIndex]);

  // Auto-expand the newest repair (and the standalone one) so there's always something to look at.
  const newestId = jobs[0]?.repair_id;
  useEffect(() => {
    const id = standaloneRepairId || newestId;
    if (id) setExpanded(prev => (prev.size === 0 ? new Set([id]) : prev));
  }, [standaloneRepairId, newestId]);

  const rebuildIndex = async () => {
    setIndexBusy(true); setError('');
    try {
      await api.buildRepairIndex();
      const tick = async () => {
        const s = await api.getRepairIndex();
        setIndex(s);
        if (!s.building) setIndexBusy(false);
        else window.setTimeout(tick, 1500);
      };
      tick();
    } catch (e) { setError(e instanceof Error ? e.message : 'Index build failed'); setIndexBusy(false); }
  };

  const toggle = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Hero ── */}
      <div className="card" style={{ padding: 20, background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(59,130,246,0.05))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 30 }}>🛠️</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>Auto-Repair Agent</h2>
            <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {standaloneRepairId
                ? 'Two agents: the RCA agent checks the docs + test case (is it a code, spec or test bug?), then the code-fixing agent retrieves the code, patches it, builds and opens a PR.'
                : 'Runs automatically whenever a test fails. Two agents work in sequence: ① the RCA agent reads the design docs + test case and decides whether it is a code bug (or a spec / invalid-test problem it should stop on); ② the code-fixing agent then retrieves the code, patches it, type-checks, builds and opens a PR. Every repair this session is listed below.'}
            </p>
          </div>
          {!standaloneRepairId && <IndexChip index={index} busy={indexBusy} onRebuild={rebuildIndex} />}
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--red)' }}>✕ {error}</p>
        </div>
      )}

      {/* ── Dashboard / standalone list ── */}
      {jobs.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No repairs yet</div>
          <p className="text-muted" style={{ fontSize: 13, margin: '6px auto 0', maxWidth: 460 }}>
            When a test fails during a run, the Auto-Repair agent starts automatically and its
            progress appears here. Nothing has failed this session — restart the backend and the
            list resets (repair history is in-memory).
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map(job => (
            <RepairCard
              key={job.repair_id}
              job={job}
              open={standaloneRepairId ? true : expanded.has(job.repair_id)}
              onToggle={() => toggle(job.repair_id)}
              onUpdated={refresh}
              lockToggle={!!standaloneRepairId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Repair card (collapsed summary → expandable pipeline) ───────────────────────

function RepairCard({ job, open, onToggle, onUpdated, lockToggle }: {
  job: RepairJob; open: boolean; onToggle: () => void; onUpdated: () => void; lockToggle: boolean;
}) {
  const running = job.status === 'pending' || job.status === 'running' || job.status === 'cancelling';
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const cancel = async (e: ReactMouseEvent) => {
    e.stopPropagation();               // don't toggle the card open/closed
    setCancelBusy(true);
    try { await api.cancelRepair(job.repair_id); onUpdated(); }
    catch { /* poll will reflect final state */ }
    finally { setCancelBusy(false); }
  };
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Summary header — always shows the repair's context so it's never ambiguous */}
      <div
        onClick={() => !lockToggle && onToggle()}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          cursor: lockToggle ? 'default' : 'pointer' }}
      >
        <OverallBadge status={job.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{job.test_id || 'Unknown test'}</strong>
            <span className={`badge ${job.auto ? 'badge-accent' : 'badge-muted'}`} style={{ fontSize: 10 }}>
              {job.auto ? 'auto' : 'manual'}
            </span>
            {job.run_id && (
              <span className="text-muted" style={{ fontSize: 11 }}>run {job.run_id}</span>
            )}
            <span className="text-muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
              {relTime(job.created_at)}
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 3, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.failure || '—'}
          </div>
        </div>
        {/* Customer-facing elaborate walkthrough of everything that happened underneath the repair. */}
        <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setReportOpen(true); }}
          title="Open a full visual report of every step of this repair">
          📋 Detailed report
        </button>
        {running && (
          <button className="btn btn-danger btn-sm" onClick={cancel} disabled={cancelBusy || job.status === 'cancelling'}
            title="Stop this repair so you can switch to other tasks">
            {job.status === 'cancelling' || cancelBusy ? '◐ Cancelling…' : '⨯ Cancel'}
          </button>
        )}
        {!lockToggle && (
          <span className="text-muted" style={{ fontSize: 12 }}>{open ? '▲' : '▼'}</span>
        )}
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <RepairPipeline job={job} running={running} onUpdated={onUpdated} />
        </div>
      )}

      {reportOpen && <DetailedReportWindow job={job} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

// ── Pipeline (the 6 stages + result banner + Open PR) ───────────────────────────

function RepairPipeline({ job, running, onUpdated }: {
  job: RepairJob; running: boolean; onUpdated: () => void;
}) {
  const [prBusy, setPrBusy]       = useState(false);
  const [prConfirm, setPrConfirm] = useState(false);
  const [prErr, setPrErr]         = useState('');
  const [delBusy, setDelBusy]     = useState(false);
  const [delConfirm, setDelConfirm] = useState(false);

  const stages = mergedStages(job);
  const visStages = visibleStages(stages);
  const firstIncomplete = visStages.findIndex(s => {
    const st = stages[s.key]?.status;
    return st !== 'done' && st !== 'warn';
  });
  const done = job.status === 'succeeded' || job.status === 'completed' || job.status === 'failed'
    || job.status === 'cancelled' || job.status === 'rca_stopped';
  const rcaStage = stages['rca'];
  const buildStage = stages['build'];
  const prStage    = stages['pr'];
  const retestStage = stages['retest'];
  const retestFailed = retestStage?.status === 'failed';
  const succeeded  = job.status === 'succeeded' || buildStage?.ok === true;

  const openPr = async () => {
    setPrBusy(true); setPrErr('');
    try {
      const outcome = await api.openRepairPr(job.repair_id);
      if (!outcome.opened) setPrErr(`PR not raised: ${outcome.output || 'see server log'}`);
      onUpdated();
    } catch (e) {
      setPrErr(e instanceof Error ? e.message : 'Open PR failed');
    } finally { setPrBusy(false); setPrConfirm(false); }
  };

  const deletePr = async () => {
    setDelBusy(true); setPrErr('');
    try {
      const outcome = await api.deleteRepairPr(job.repair_id);
      if (!outcome.deleted) setPrErr(`PR not deleted: ${outcome.output || 'see server log'}`);
      onUpdated();
    } catch (e) {
      setPrErr(e instanceof Error ? e.message : 'Delete PR failed');
    } finally { setDelBusy(false); setDelConfirm(false); }
  };

  return (
    <>
      {/* When the verification retest is running, its live status feed pops up as an overlay window,
          then closes on completion — revealing the (now-updated) auto-repair status underneath. */}
      <RetestOverlayHost stage={retestStage} testId={job.test_id || ''} onDone={onUpdated} />

      <div style={{ padding: '8px 18px 18px' }}>
        {visStages.map((meta, i) => {
          const st = stages[meta.key];
          const isActive = running && i === firstIncomplete;
          let kind = statusOf(st, isActive);
          // "Raise PR" must NOT read as done while the fix is only PREPARED and a verification retest is
          // still gating it (the PR is opened only AFTER the retest passes). Without this the branch/commit
          // prepared by prepare_pr shows a green ✓ before the retest even starts. Only when the retest
          // exists do we gate: opened → done · retest failed/gated → warn · otherwise → pending.
          if (meta.key === 'pr' && st && retestStage) {
            const opened = st.opened?.opened;
            kind = opened ? 'done'
              : (retestStage.status === 'running' || !retestStage.status) ? 'pending'  // retest in flight
              : 'warn';   // retest finished but PR not opened (failed/gated, or passed with auto-PR off) → prepared
          }
          // A header before the FIRST stage of each agent makes the two-agent design explicit.
          const showAgentHeader = i === 0 || visStages[i - 1].agent !== meta.agent;
          return (
            <div key={meta.key}>
              {showAgentHeader && <AgentHeader agent={meta.agent} />}
              <StageRow meta={meta} stage={st} kind={kind} last={i === visStages.length - 1} />
            </div>
          );
        })}
      </div>

      {job.status === 'awaiting_rca_review' && <RcaReviewPanel job={job} onUpdated={onUpdated} />}

      {done && (
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)',
          background: succeeded ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}>
          {succeeded ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${retestFailed ? 'badge-yellow' : 'badge-green'}`}>
                {retestStage?.passed ? '✓ Fixed & verified' : retestFailed ? '⚠ Built, retest failing' : '✓ Fixed & built'}
              </span>
              <span className="text-muted" style={{ fontSize: 13 }}>
                The agent repaired {stages['apply']?.file || 'the code'} and the build passed.
                {retestStage?.passed && ` Re-running ${job.test_id || 'the test'} passed — the fix is verified.`}
                {retestFailed && ` But re-running ${job.test_id || 'the test'} still failed, so the PR was not raised automatically`
                  + ' (check the running app serves the fixed code) — you can open it manually below.'}
                {!retestStage && prStage?.prepared && ' A PR branch is ready.'}
              </span>
              {prStage?.prepared && !prStage?.opened?.opened && (
                prConfirm ? (
                  <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }}>
                    <button className="btn btn-primary btn-sm" onClick={openPr} disabled={prBusy}>
                      {prBusy ? '◐ Opening…' : `Confirm push to ${prStage.remote}/${prStage.branch}`}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setPrConfirm(false)} disabled={prBusy}>Cancel</button>
                  </span>
                ) : (
                  <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => setPrConfirm(true)}>🔀 Open PR</button>
                )
              )}
              {prStage?.opened?.opened && (
                <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
                  <a className="badge badge-accent" style={{ textDecoration: 'none' }}
                    href={prStage.opened.url} target="_blank" rel="noreferrer">↗ View PR</a>
                  {delConfirm ? (
                    <>
                      <button className="btn btn-danger btn-sm" onClick={deletePr} disabled={delBusy}>
                        {delBusy ? '◐ Deleting…' : `Confirm delete ${prStage.branch}`}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setDelConfirm(false)} disabled={delBusy}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => setDelConfirm(true)}
                      title="Delete the pushed fix branch (closes the PR) so demo runs don't pile up">🗑 Delete PR</button>
                  )}
                </span>
              )}
              {prStage?.deleted?.deleted && !prStage?.opened?.opened && (
                <span className="badge badge-muted" style={{ marginLeft: 'auto' }}>PR deleted</span>
              )}
            </div>
          ) : job.status === 'cancelled' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge badge-muted">⨯ Cancelled</span>
              <span className="text-muted" style={{ fontSize: 13 }}>
                Repair was cancelled — no changes were committed. Re-run the failed test to try again.
              </span>
            </div>
          ) : job.status === 'rca_stopped' ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <span className="badge badge-yellow">
                🛑 {rcaStage?.verdict === 'test_invalid' ? 'Test is invalid' : 'Spec/requirements bug'}
              </span>
              <span className="text-muted" style={{ fontSize: 13, flex: 1, minWidth: 240 }}>
                The RCA agent stopped the repair before touching code: {rcaStage?.rationale
                  || job.rca?.rationale || 'the failure is in the spec or the test, not the app code.'}
                {' '}No code was changed — fix the {rcaStage?.verdict === 'test_invalid' ? 'test case' : 'design/requirements'} and re-run.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge badge-red">✕ Repair incomplete</span>
              <span className="text-muted" style={{ fontSize: 13 }}>
                {job.error || 'The build did not pass — see the stage output above.'}
              </span>
            </div>
          )}
          {prErr && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)' }}>✕ {prErr}</p>}
        </div>
      )}
    </>
  );
}

// ── RCA human-review gate (shown when human_review_rca is ON and the pipeline paused) ───────────
function RcaReviewPanel({ job, onUpdated }: { job: RepairJob; onUpdated: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const rca = mergedStages(job)['rca'] || job.rca || {};
  const vlabel: Record<string, string> = {
    code_bug: 'Code bug', spec_bug: 'Requirements / spec bug', test_invalid: 'Invalid test case',
    environment: 'Environment / infra issue', unknown: 'Undetermined',
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !reason.trim()) { setErr('Please enter a reason to reject.'); return; }
    setBusy(decision); setErr('');
    try { await api.reviewRepairRca(job.repair_id, decision, reason.trim()); onUpdated(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Review failed'); }
    finally { setBusy(''); }
  };

  return (
    <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)', background: 'rgba(234,179,8,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="badge badge-yellow">⏸ Review the root cause</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{vlabel[rca.verdict || ''] || rca.verdict || '—'}</span>
        {rca.confidence && <span className="text-muted" style={{ fontSize: 12 }}>{rca.confidence} confidence</span>}
      </div>
      {rca.rationale && <div style={{ fontSize: 12.5, marginBottom: 6 }}>💬 {rca.rationale}</div>}
      {rca.suspect && <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>🎯 Suspect: {rca.suspect}</div>}
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        The code-fixing agent will run only after you approve. Reject to send the RCA agent your reason and have it re-analyse.
      </div>
      {!rejecting ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => decide('approve')}>
            {busy === 'approve' ? '◐ Approving…' : '✓ Approve → run the fix'}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setRejecting(true)}>✕ Reject</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Why is this root cause wrong? The RCA agent will reconsider with this feedback."
            style={{ width: '100%', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-danger btn-sm" disabled={busy === 'reject'} onClick={() => decide('reject')}>
              {busy === 'reject' ? '◐ Re-analysing…' : 'Submit reject & re-run RCA'}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => { setRejecting(false); setReason(''); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div style={{ fontSize: 12, marginTop: 8, color: 'var(--red)' }}>✕ {err}</div>}
    </div>
  );
}

// ── Retest overlay (live status feed of the fix-verification re-run) ─────────────
// While the Auto-Repair agent re-runs the failed test to verify the fix, its live feed pops up as a
// floating overlay window. It closes automatically when the retest finishes — revealing the updated
// repair status underneath (with the PR raised on a pass). Subscribes directly to the retest run's
// WebSocket so the feed is real-time; the parent's 2.5s poll only governs when this mounts/unmounts.

function RetestOverlayHost({ stage, testId, onDone }: {
  stage?: RepairStage; testId: string; onDone: () => void;
}) {
  const [closed, setClosed] = useState<string>('');   // a retest run_id we've already dismissed
  const runId = stage?.run_id || '';
  const show = stage?.status === 'running' && !!runId && runId !== closed;
  if (!show) return null;
  return <RetestOverlay runId={runId} testId={testId}
    onClose={() => { setClosed(runId); onDone(); }} />;
}

function RetestOverlay({ runId, testId, onClose }: { runId: string; testId: string; onClose: () => void }) {
  const [feed, setFeed]     = useState<{ ts: string; text: string; cls: string }[]>([]);
  const [status, setStatus] = useState<'running' | 'passed' | 'failed'>('running');
  const feedRef   = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const push = (text: string, cls = 'line-info') =>
      setFeed(f => [...f.slice(-200), { ts: new Date().toLocaleTimeString(), text, cls }]);
    push(`🔁 Re-running ${testId} to verify the fix…`);
    const ws = runWs(runId, (ev) => {
      const e = ev as { event: string; test_id?: string; outcome?: string; step_index?: number;
        step?: string; success?: boolean; note?: string; failed?: number; error?: string; message?: string };
      if (e.event === 'test_started') push(`▶ [${e.test_id}] started`);
      else if (e.event === 'step_result') push(`${e.success ? '  ✓' : '  ✗'} step ${e.step_index}: ${e.step}`, e.success ? 'line-pass' : 'line-fail');
      else if (e.event === 'test_result') push(`  [${e.test_id}] ${e.outcome === 'passed' ? '✓ PASS' : '✗ FAIL'}`, e.outcome === 'passed' ? 'line-pass' : 'line-fail');
      else if (e.event === 'log' && e.message) push(String(e.message), 'line-muted');
      else if (e.event === 'run_completed') {
        const ok = !(e.failed && e.failed > 0);
        setStatus(ok ? 'passed' : 'failed');
        push(ok ? '✓ Retest passed — the fix is verified' : '✗ Retest still failing', ok ? 'line-pass' : 'line-fail');
        closeTimer.current = window.setTimeout(onClose, 1800);
      } else if (e.event === 'run_error') {
        setStatus('failed');
        push(`✗ Retest error: ${e.error || ''}`, 'line-fail');
        closeTimer.current = window.setTimeout(onClose, 1800);
      }
    });
    return () => { ws.close(); if (closeTimer.current) window.clearTimeout(closeTimer.current); };
    // Re-subscribe only when the retest run changes; onClose is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, testId]);

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed]);

  const head = status === 'passed' ? { c: 'var(--green)', t: '✓ Fix verified — retest passed' }
    : status === 'failed' ? { c: 'var(--red)', t: '✗ Retest still failing' }
    : { c: 'var(--accent)', t: `🔁 Verifying the fix — re-running ${testId}` };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 94vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', border: `1px solid ${head.c}`, background: 'var(--surface)', color: 'var(--text)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span className={status === 'running' ? 'blink' : ''} style={{ fontSize: 18 }}>
            {status === 'passed' ? '✅' : status === 'failed' ? '⚠️' : '🔁'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: head.c }}>{head.t}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Verification re-run · {runId}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {status === 'running' ? 'Hide' : 'Close'}
          </button>
        </div>
        <div className="live-feed" ref={feedRef} style={{ flex: 1, overflow: 'auto', margin: 0, borderRadius: 0 }}>
          {feed.length === 0
            ? <span className="line-muted">Connecting to the retest…</span>
            : feed.map((l, i) => (
                <div key={i} className={l.cls}>
                  {l.ts && <span style={{ color: 'var(--muted)', marginRight: 8 }}>{l.ts}</span>}{l.text}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IndexChip({ index, busy, onRebuild }: {
  index: IndexState; busy: boolean; onRebuild: () => void;
}) {
  const label = !index ? 'unknown' : index.building || busy ? 'building…' : index.exists ? 'ready' : 'not built';
  const cls = !index ? 'badge-muted' : index.building || busy ? 'badge-blue' : index.exists ? 'badge-green' : 'badge-yellow';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <span className={`badge ${cls}`}>RAG index: {label}</span>
      <button className="btn btn-secondary btn-sm" onClick={onRebuild} disabled={busy || index?.building}>
        {busy || index?.building ? '◐ Indexing…' : '↻ Rebuild index'}
      </button>
      {index?.message && (
        <span className="text-muted" style={{ fontSize: 10, maxWidth: 240, textAlign: 'right' }}>{index.message}</span>
      )}
    </div>
  );
}

function OverallBadge({ status }: { status: RepairJob['status'] }) {
  const map: Record<RepairJob['status'], [string, string]> = {
    pending:     ['badge-muted',  'Pending'],
    running:     ['badge-blue',   '◐ Running'],
    cancelling:  ['badge-yellow', '◐ Cancelling…'],
    cancelled:   ['badge-muted',  '⨯ Cancelled'],
    succeeded:   ['badge-green',  '✓ Succeeded'],
    completed:   ['badge-yellow', 'Completed'],
    failed:      ['badge-red',    '✕ Failed'],
    rca_stopped: ['badge-yellow', '🛑 RCA stopped'],
    awaiting_rca_review: ['badge-yellow', '⏸ Awaiting review'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

// A labelled divider that makes the TWO separate agents explicit in the pipeline.
function AgentHeader({ agent }: { agent: 'rca' | 'fix' }) {
  const m = AGENT_META[agent];
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 10px', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{m.num} {m.name}</span>
      <span className="text-muted" style={{ fontSize: 11 }}>{m.blurb}</span>
    </div>
  );
}

function StageRow({ meta, stage, kind, last }: {
  meta: StageMeta; stage: RepairStage | undefined; kind: StatusKind; last: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dot = DOT[kind];
  const hasDetail = !!stage && (kind === 'done' || kind === 'warn' || kind === 'failed');

  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {/* rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${dot.ring}`, color: dot.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700,
          animation: kind === 'running' ? 'spin 1.4s linear infinite' : undefined,
          background: 'var(--surface)',
        }}>{dot.glyph}</div>
        {!last && <div style={{ width: 2, flex: 1, minHeight: 16, background: 'var(--border)' }} />}
      </div>

      {/* body */}
      <div style={{ flex: 1, paddingBottom: last ? 4 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: hasDetail ? 'pointer' : 'default' }}
          onClick={() => hasDetail && setOpen(o => !o)}>
          <span style={{ fontSize: 15 }}>{meta.icon}</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{meta.label}</span>
          {/* Show the tool that actually ran this stage (e.g. GraphRAG + Neo4j, Llama · model) when the
              backend reports it; fall back to the generic label otherwise. */}
          <span className="text-muted" style={{ fontSize: 11 }}>{stage?.tool ?? meta.sub}</span>
          {kind === 'running' && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {stage?.note && <span className="text-muted" style={{ fontSize: 11 }}>{stage.note}</span>}
              <span className="badge badge-blue">working…</span>
            </span>
          )}
          {kind !== 'running' && hasDetail && <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{open ? '▲' : '▼'}</span>}
        </div>
        {open && stage && <StageDetail stageKey={meta.key} stage={stage} />}
      </div>
    </div>
  );
}

function StageDetail({ stageKey, stage }: { stageKey: string; stage: RepairStage }) {
  const box: CSSProperties = {
    marginTop: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
    borderRadius: 6, padding: 10, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5,
    whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 280,
  };

  if (stageKey === 'rca') {
    const vmap: Record<string, [string, string]> = {
      code_bug:     ['badge-blue',   'Code bug'],
      spec_bug:     ['badge-yellow', 'Spec/requirements bug'],
      test_invalid: ['badge-yellow', 'Test is invalid'],
      environment:  ['badge-yellow', 'Environment / infra issue'],
      unknown:      ['badge-muted',  'Undetermined'],
      skipped:      ['badge-muted',  'RCA skipped'],
    };
    const [vcls, vlabel] = vmap[stage.verdict || 'skipped'] || ['badge-muted', stage.verdict || '—'];
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
          <span className={`badge ${vcls}`}>{vlabel}</span>
          {stage.confidence && <span className="text-muted">confidence: {stage.confidence}</span>}
          {stage.stop && <span className="badge badge-red">stopped the repair</span>}
        </div>
        {stage.rationale && <div style={{ fontSize: 12 }}>💬 {stage.rationale}</div>}
        {stage.suspect && (
          <div className="text-muted" style={{ fontSize: 12 }}>
            🎯 suspect area handed to the code-fixing agent: <strong>{stage.suspect}</strong>
          </div>
        )}
        {stage.hits && stage.hits.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="text-muted" style={{ fontSize: 11 }}>Docs / test cases the RCA agent read (no source code):</div>
            {stage.hits.map((h, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ padding: '6px 10px', background: 'var(--surface2)', fontSize: 11, display: 'flex', gap: 8 }}>
                  <span className="badge badge-muted">{h.type}</span>
                  <span className="text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.file}</span>
                </div>
                <pre style={{ margin: 0, padding: 10, fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: 'var(--text)', maxHeight: 120, overflow: 'auto' }}>{h.snippet}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (stageKey === 'retrieve' && stage.hits) {
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stage.hits.map((h, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', background: 'var(--surface2)', fontSize: 11, display: 'flex', gap: 8 }}>
              <span className="badge badge-muted">{h.type}</span>
              <span className="text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.file}{h.start_line ? `  (L${h.start_line}–${h.end_line})` : ''}
              </span>
            </div>
            <pre style={{ margin: 0, padding: 10, fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: 'var(--text)', maxHeight: 150, overflow: 'auto' }}>{h.snippet}</pre>
          </div>
        ))}
      </div>
    );
  }

  if (stageKey === 'diagnose' && stage.patch) {
    const p = stage.patch;
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, marginBottom: 8 }}>💡 {p.explanation}</div>
        <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>{p.file_path}</div>
        <div style={{ ...box, whiteSpace: 'pre-wrap' }}>
          <div style={{ color: 'var(--red)' }}>- {p.find}</div>
          <div style={{ color: 'var(--green)' }}>+ {p.replace}</div>
        </div>
      </div>
    );
  }

  if (stageKey === 'retest') {
    const ok = stage.passed === true;
    const rb = stage.rebuild;
    return (
      <div style={{ marginTop: 8, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${ok ? 'badge-green' : 'badge-red'}`}>
            {ok ? '✓ passed on retest' : '✕ still failing'}
          </span>
          {stage.run_id && <span className="text-muted">verification run {stage.run_id}</span>}
        </div>
        {/* Which branch + commit the fix was built and re-tested against — the same info shown under Raise
            PR, surfaced here so you can confirm the retest ran on the repair branch (not the base). */}
        {(stage.branch || stage.commit) && (
          <div style={{ fontSize: 11 }}>
            built &amp; retested on{' '}
            <span className="badge badge-accent">{stage.branch || '—'}</span>
            {stage.commit && <span className="text-muted"> · commit {stage.commit}</span>}
          </div>
        )}
        {rb?.ran && (
          <div style={{ fontSize: 11 }}>
            <span className="text-muted">$ {rb.cmd}</span>{' '}
            <span style={{ color: rb.ok === false ? 'var(--red)' : 'var(--green)' }}>
              {rb.ok === false ? 'rebuild failed' : 'rebuilt with the fix'}
            </span>
          </div>
        )}
        <div className="text-muted">
          {rb?.ran ? 'The app was rebuilt with the fix, then the failed test was executed again against it'
                   : 'The failed test was executed again against the patched code'}
          {ok ? ' and passed — the fix is verified, so the PR was raised.'
              : ' and did not pass — the PR was gated. Ensure the running app serves the fix, then re-run or open the PR manually.'}
        </div>
        {stage.restore?.ran && (
          <div className="text-muted" style={{ fontSize: 11 }}>
            Baseline restored after the retest ({stage.restore.ok === false ? 'restore reported an error' : 'ok'})
            {stage.restore.branch && <> → app now on <span className="badge badge-muted">{stage.restore.branch}</span>
              {stage.restore.commit && ` · commit ${stage.restore.commit}`}</>} — the fix lives in the PR.
          </div>
        )}
        <div className="text-muted" style={{ fontSize: 11 }}>
          This re-run is recorded in Results and the run history like any other run.
        </div>
      </div>
    );
  }

  if (stageKey === 'pr') {
    return (
      <div style={{ marginTop: 8, fontSize: 12 }}>
        {stage.prepared ? (
          <>
            <div style={{ marginBottom: 6 }}>
              <span className="badge badge-accent">{stage.branch}</span>{' '}
              <span className="text-muted">→ {stage.remote}/{stage.base} · commit {stage.commit}</span>
            </div>
            <DiffBlock diff={stage.diff || ''} />
          </>
        ) : (
          <div className="text-muted">Branch not prepared: {stage.diff || 'no git repo / commit failed'}</div>
        )}
      </div>
    );
  }

  // test / build / apply — command output
  const out = stage.output || (stage.file ? `patched ${stage.file}` : '(no output)');
  const okColor = stage.ok === false ? 'var(--red)' : 'var(--green)';
  return (
    <div style={{ marginTop: 8 }}>
      {stage.cmd && (
        <div style={{ fontSize: 11, marginBottom: 6 }}>
          <span className="text-muted">$ {stage.cmd}</span>{' '}
          <span style={{ color: okColor }}>{stage.ok === false ? `exit ${stage.code}` : 'exit 0'}</span>
        </div>
      )}
      <div style={box}>{out}</div>
    </div>
  );
}

// ── Detailed report window (customer-facing elaborate walkthrough) ──────────────
// A floating window (minimize / maximize / close) that shows, step by step, EVERYTHING that happened
// underneath a repair: what the RCA agent read and concluded, what code the retrieval surfaced, and —
// the centrepiece — EXACTLY what was sent to Claude to diagnose (the failure description, the actual
// step screenshots, and the retrieved code + doc context) and the fix Claude returned, then apply /
// test / build / PR. Reads only data already on the job (no extra endpoints).

type WinState = 'normal' | 'min' | 'max';

type ReportView = 'summary' | 'technical';

function DetailedReportWindow({ job, onClose }: { job: RepairJob; onClose: () => void }) {
  const [win, setWin] = useState<WinState>('normal');
  const [view, setView] = useState<ReportView>('summary');   // executive summary is the default view
  const [pendingAnchor, setPendingAnchor] = useState<string>('');
  const stages = mergedStages(job);
  const runId = job.run_id || '';

  // A summary chart's "view details" link switches to the technical view and scrolls to that section.
  const jumpTo = (anchor: string) => { setView('technical'); setPendingAnchor(anchor); };
  useEffect(() => {
    if (view === 'technical' && pendingAnchor) {
      const id = pendingAnchor;
      const t = window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setPendingAnchor('');
      }, 60);
      return () => window.clearTimeout(t);
    }
  }, [view, pendingAnchor]);

  const frame: CSSProperties = win === 'max'
    ? { inset: 12, width: 'auto', height: 'auto' }
    : win === 'min'
      ? { right: 24, bottom: 24, width: 420, height: 'auto' }
      : { top: '5vh', left: '50%', transform: 'translateX(-50%)', width: 'min(960px, 94vw)', height: '88vh' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
      display: win === 'min' ? 'block' : 'flex' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'fixed', ...frame, display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}
      >
        {/* title bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.20), rgba(59,130,246,0.08))',
          borderBottom: '1px solid var(--border)', cursor: 'default' }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Auto-Repair — Detailed Report</div>
            <div className="text-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.test_id || 'Unknown test'}{runId ? ` · run ${runId}` : ''} · {job.repair_id}
            </div>
          </div>
          {/* view toggle — executive summary (default) vs full technical detail */}
          {win !== 'min' && (
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginRight: 6 }}>
              {(['summary', 'technical'] as ReportView[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  style={{ border: 'none', cursor: 'pointer', fontSize: 12, padding: '5px 12px',
                    background: view === v ? 'var(--accent)' : 'transparent',
                    color: view === v ? '#fff' : 'var(--muted)', fontWeight: view === v ? 700 : 500 }}>
                  {v === 'summary' ? 'Executive summary' : 'Technical details'}
                </button>
              ))}
            </div>
          )}
          <button className="btn btn-secondary btn-sm" title="Minimize" onClick={() => setWin('min')}>—</button>
          <button className="btn btn-secondary btn-sm" title={win === 'max' ? 'Restore' : 'Maximize'}
            onClick={() => setWin(win === 'max' ? 'normal' : 'max')}>{win === 'max' ? '❐' : '▢'}</button>
          <button className="btn btn-secondary btn-sm" title="Close" onClick={onClose}>✕</button>
        </div>

        {/* body */}
        {win !== 'min' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {view === 'summary' ? (
              <ExecutiveSummary job={job} stages={stages} onJump={jumpTo} />
            ) : (
              <>
                <ReportOverview job={job} />
                <ReportAgent num="①" name="RCA Agent"
                  blurb="reads the design docs + test case (never source code) and decides: is this a code bug, or a spec / invalid-test / environment problem it should stop on?">
                  <RcaReport stage={stages['rca']} />
                </ReportAgent>
                <ReportAgent num="②" name="Code-Fixing Agent"
                  blurb="retrieves the offending code, asks Claude for one minimal patch, applies it, type-checks, builds and prepares a PR.">
                  <RetrieveReport stage={stages['retrieve']} />
                  <DiagnoseReport stage={stages['diagnose']} runId={runId} />
                  <ApplyReport stage={stages['apply']} />
                  <CmdReport title="Unit test (TypeScript type-check)" icon="🧪" stage={stages['test']} anchor="sec-test" />
                  <CmdReport title="Build (tsc -b + vite build)" icon="🏗️" stage={stages['build']} anchor="sec-build" />
                  {stages['retest'] && <RetestReport stage={stages['retest']} />}
                  <PrReport stage={stages['pr']} />
                </ReportAgent>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportOverview({ job }: { job: RepairJob }) {
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <OverallBadge status={job.status} />
        <strong style={{ fontSize: 14 }}>{job.test_id || 'Unknown test'}</strong>
        <span className={`badge ${job.auto ? 'badge-accent' : 'badge-muted'}`} style={{ fontSize: 10 }}>
          {job.auto ? 'auto-triggered by a failed run' : 'manual'}
        </span>
      </div>
      <div>
        <SectionLabel>What failed</SectionLabel>
        <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{job.failure || '—'}</div>
      </div>
    </div>
  );
}

function ReportAgent({ num, name, blurb, children }: {
  num: string; name: string; blurb: string; children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
        borderBottom: '2px solid var(--border)', paddingBottom: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{num} {name}</span>
        <span className="text-muted" style={{ fontSize: 11 }}>{blurb}</span>
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{children}</div>;
}

function ReportBlock({ icon, title, children, anchor }: { icon: string; title: string; children: ReactNode; anchor?: string }) {
  return (
    <div id={anchor} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{icon} {title}</div>
      {children}
    </div>
  );
}

const codeBox: CSSProperties = {
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 10,
  fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 320,
};

function HitCards({ hits, label }: { hits?: RepairStage['hits']; label: string }) {
  if (!hits || hits.length === 0) return <div className="text-muted" style={{ fontSize: 12 }}>{label}: none</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hits.map((h, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ padding: '6px 10px', background: 'var(--surface2)', fontSize: 11, display: 'flex', gap: 8 }}>
            <span className="badge badge-muted">{h.type || 'chunk'}</span>
            <span className="text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.file}{h.start_line ? `  (L${h.start_line}–${h.end_line})` : ''}
            </span>
          </div>
          <pre style={{ margin: 0, padding: 10, fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: 'var(--text)', maxHeight: 200, overflow: 'auto' }}>{h.snippet}</pre>
        </div>
      ))}
    </div>
  );
}

function RcaReport({ stage }: { stage?: RepairStage }) {
  if (!stage) return <ReportBlock icon="🕵️" title="Root-cause analysis" anchor="sec-rca"><div className="text-muted" style={{ fontSize: 12 }}>Not run yet.</div></ReportBlock>;
  const vmap: Record<string, [string, string]> = {
    code_bug: ['badge-blue', 'Code bug — hand to the fixer'],
    spec_bug: ['badge-yellow', 'Spec/requirements bug — STOP'],
    test_invalid: ['badge-yellow', 'Test is invalid — STOP'],
    environment: ['badge-yellow', 'Environment / infra issue — STOP'],
    unknown: ['badge-muted', 'Undetermined — verify in code'],
    skipped: ['badge-muted', 'RCA skipped'],
  };
  const [vcls, vlabel] = vmap[stage.verdict || 'skipped'] || ['badge-muted', stage.verdict || '—'];
  return (
    <ReportBlock icon="🕵️" title="Root-cause analysis — what the RCA agent decided" anchor="sec-rca">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span className={`badge ${vcls}`}>{vlabel}</span>
        {stage.confidence && <span className="text-muted">confidence: {stage.confidence}</span>}
        {stage.stop && <span className="badge badge-red">stopped the repair — no code changed</span>}
      </div>
      {stage.rationale && <div><SectionLabel>Rationale</SectionLabel><div style={{ fontSize: 12 }}>💬 {stage.rationale}</div></div>}
      {stage.suspect && <div><SectionLabel>Suspect area handed to the fixer</SectionLabel><div style={{ fontSize: 12 }}>🎯 <strong>{stage.suspect}</strong></div></div>}
      <div>
        <SectionLabel>Docs / test cases the RCA agent read (no source code)</SectionLabel>
        <HitCards hits={stage.hits} label="Documents read" />
      </div>
    </ReportBlock>
  );
}

function RetrieveReport({ stage }: { stage?: RepairStage }) {
  return (
    <ReportBlock icon="🔎" title="Retrieve — the code chunks the RAG surfaced for Claude" anchor="sec-retrieve">
      <div className="text-muted" style={{ fontSize: 11 }}>Tool: {stage?.tool || '—'}</div>
      <HitCards hits={stage?.hits} label="Retrieved code" />
    </ReportBlock>
  );
}

function DiagnoseReport({ stage, runId }: { stage?: RepairStage; runId: string }) {
  const inputs = stage?.inputs;
  const shots = inputs?.screenshots || [];
  const p = stage?.patch;
  return (
    <ReportBlock icon="🧠" title="Diagnose — exactly what was sent to Claude, and the fix it returned" anchor="sec-diagnose">
      <div className="text-muted" style={{ fontSize: 11 }}>Tool: {stage?.tool || '—'}</div>

      <div>
        <SectionLabel>1 · Failure description sent to the model</SectionLabel>
        <div style={codeBox}>{inputs?.failure || '(not captured)'}</div>
      </div>

      <div>
        <SectionLabel>2 · Failed-step screenshots {shots.length ? '(attached for Claude — multimodal)' : ''}</SectionLabel>
        {shots.length && runId ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {shots.map((name, i) => (
              <a key={i} href={runScreenshotUrl(runId, name)} target="_blank" rel="noreferrer"
                style={{ display: 'block', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <img src={runScreenshotUrl(runId, name)} alt={name}
                  style={{ display: 'block', maxWidth: 220, maxHeight: 160, objectFit: 'contain', background: '#000' }} />
              </a>
            ))}
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: 12 }}>
            No screenshots attached (a text-only local model, or none were captured).
          </div>
        )}
      </div>

      <div>
        <SectionLabel>3 · Retrieved code &amp; doc context sent to the model</SectionLabel>
        <div style={codeBox}>{inputs?.context || '(not captured)'}</div>
      </div>

      <div>
        <SectionLabel>Claude's answer — the minimal patch</SectionLabel>
        {p ? (
          <>
            <div style={{ fontSize: 12, marginBottom: 6 }}>💡 {p.explanation}</div>
            <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>{p.file_path}</div>
            <div style={{ ...codeBox }}>
              <div style={{ color: 'var(--red)' }}>- {p.find}</div>
              <div style={{ color: 'var(--green)' }}>+ {p.replace}</div>
            </div>
          </>
        ) : <div className="text-muted" style={{ fontSize: 12 }}>No patch produced.</div>}
      </div>
    </ReportBlock>
  );
}

function ApplyReport({ stage }: { stage?: RepairStage }) {
  return (
    <ReportBlock icon="🩹" title="Apply — the single-occurrence patch" anchor="sec-apply">
      <div style={{ fontSize: 12 }}>
        {stage?.file ? <>Patched <strong>{stage.file}</strong>.</> : <span className="text-muted">Not applied.</span>}
      </div>
    </ReportBlock>
  );
}

function CmdReport({ title, icon, stage, anchor }: { title: string; icon: string; stage?: RepairStage; anchor?: string }) {
  if (!stage) return <ReportBlock icon={icon} title={title} anchor={anchor}><div className="text-muted" style={{ fontSize: 12 }}>Not run.</div></ReportBlock>;
  const okColor = stage.ok === false ? 'var(--red)' : 'var(--green)';
  return (
    <ReportBlock icon={icon} title={title} anchor={anchor}>
      {stage.cmd && (
        <div style={{ fontSize: 11 }}>
          <span className="text-muted">$ {stage.cmd}</span>{' '}
          <span style={{ color: okColor }}>{stage.ok === false ? `exit ${stage.code}` : 'exit 0'}</span>
        </div>
      )}
      <div style={codeBox}>{stage.output || '(no output)'}</div>
    </ReportBlock>
  );
}

function PrReport({ stage }: { stage?: RepairStage }) {
  return (
    <ReportBlock icon="🔀" title="Raise PR — branch, commit &amp; diff" anchor="sec-pr">
      {stage?.prepared ? (
        <>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <span className="badge badge-accent">{stage.branch}</span>{' '}
            <span className="text-muted">→ {stage.remote}/{stage.base} · commit {stage.commit}</span>
          </div>
          <DiffBlock diff={stage.diff || ''} />
        </>
      ) : (
        <div className="text-muted" style={{ fontSize: 12 }}>Branch not prepared: {stage?.diff || 'no git repo / commit failed / build not green'}</div>
      )}
    </ReportBlock>
  );
}

function RetestReport({ stage }: { stage?: RepairStage }) {
  if (!stage) return null;
  const ok = stage.passed === true;
  const rb = stage.rebuild;
  return (
    <ReportBlock icon="🔁" title="Re-test — rebuild with the fix, then re-run the failed test" anchor="sec-retest">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span className={`badge ${ok ? 'badge-green' : 'badge-red'}`}>{ok ? '✓ passed on retest' : '✕ still failing'}</span>
        {stage.run_id && <span className="text-muted">verification run {stage.run_id}</span>}
      </div>
      {(stage.branch || stage.commit) && (
        <div style={{ fontSize: 12 }}>
          <SectionLabel>Built &amp; retested against</SectionLabel>
          <span className="badge badge-accent">{stage.branch || '—'}</span>
          {stage.commit && <span className="text-muted"> · commit {stage.commit}</span>}
          {stage.restore?.branch && <span className="text-muted"> — baseline restored to {stage.restore.branch}
            {stage.restore.commit ? ` · ${stage.restore.commit}` : ''}</span>}
        </div>
      )}
      {rb?.ran && (
        <div>
          <SectionLabel>App rebuilt with the fix</SectionLabel>
          <div style={{ fontSize: 11, marginBottom: 4 }}>
            <span className="text-muted">$ {rb.cmd}</span>{' '}
            <span style={{ color: rb.ok === false ? 'var(--red)' : 'var(--green)' }}>{rb.ok === false ? `exit ${rb.code ?? '≠0'}` : 'exit 0'}</span>
          </div>
          {rb.output && <div style={codeBox}>{rb.output}</div>}
        </div>
      )}
      <div className="text-muted" style={{ fontSize: 12 }}>
        {rb?.ran ? 'The app image was rebuilt from the fix branch and the failed test was re-run against it'
                 : 'The failed test was executed again against the patched code (served live by the dev server)'}
        {ok ? ' — it passed, so the pull request was raised automatically.'
            : ' — it did not pass, so the PR was gated (the branch is prepared; open it manually once the running app serves the fix).'}
        {' '}This re-run is a real run recorded in Results and the run history.
        {stage.restore?.ran && ' Afterwards the app was restored to the run\'s baseline branch (the fix lives in the PR).'}
      </div>
    </ReportBlock>
  );
}

// ── Executive Summary (default report view) — consolidates the technical detail into charts ──────
// Audience: leadership. Every chart carries a "View technical details →" link back to its section.

const CONF_PCT: Record<string, number> = { high: 92, medium: 60, low: 28 };
function confPct(c?: string): number { return CONF_PCT[(c || '').toLowerCase()] ?? 0; }

const VERDICT_LABEL: Record<string, string> = {
  code_bug: 'Code bug', spec_bug: 'Requirements / spec bug', test_invalid: 'Invalid test case',
  environment: 'Environment / infra issue', unknown: 'Undetermined', skipped: 'Not analysed',
};

function ExecutiveSummary({ job, stages, onJump }: {
  job: RepairJob; stages: Record<string, RepairStage>; onJump: (anchor: string) => void;
}) {
  const rca = stages['rca']; const retrieve = stages['retrieve']; const diagnose = stages['diagnose'];
  const apply = stages['apply']; const build = stages['build']; const pr = stages['pr'];
  const retest = stages['retest'];
  const retestFailed = retest?.status === 'failed';
  const retestPassed = retest?.status === 'done' && retest?.passed === true;
  const patch = diagnose?.patch;
  const verdict = rca?.verdict || 'skipped';
  const docsRead = rca?.hits?.length || 0;
  const codeChunks = retrieve?.hits?.length || 0;
  const shots = diagnose?.inputs?.screenshots?.length || 0;
  const fileChanged = apply?.file || '';
  const linesChanged = patch ? Math.max(String(patch.find || '').split('\n').length, String(patch.replace || '').split('\n').length) : 0;
  const succeeded = job.status === 'succeeded' || build?.ok === true;
  const rcaStopped = job.status === 'rca_stopped';
  // The RCA verdict is only ADVISORY when it did not STOP the pipeline (medium/low confidence). If the
  // code-fixing agent then applied a fix and the build passed, the VERIFIED root cause is a code bug — so
  // the headline "Root cause" must reflect that, not a non-stopping (and here wrong) spec/test advisory
  // that would contradict "Bug fixed & verified". When RCA actually stopped, its verdict stands.
  const patchVerified = !!fileChanged && succeeded && !rcaStopped;
  const effectiveVerdict = patchVerified ? 'code_bug' : verdict;
  const rcaDisagreed = patchVerified && verdict !== 'code_bug' && verdict !== 'skipped';
  const cancelled = job.status === 'cancelled';

  const outcome = succeeded && retestFailed
    ? { color: 'var(--yellow)', bg: 'rgba(234,179,8,0.12)', icon: '⚠', head: 'Fixed & built — retest still failing',
        line: `The agent patched ${fileChanged || 'the code'} and the build passed, but re-running ${job.test_id || 'the test'} still failed, so the PR was gated. Confirm the running app serves the fixed code, then re-run or open the PR manually.` }
    : succeeded
    ? { color: 'var(--green)', bg: 'rgba(34,197,94,0.12)', icon: '✓', head: retestPassed ? 'Bug fixed & verified by retest' : 'Bug fixed & verified',
        line: `The agent found the root cause, patched ${fileChanged || 'the code'} and the build passed`
          + (retestPassed ? ` — re-running ${job.test_id || 'the test'} passed and a pull request was raised.`
             : pr?.prepared ? ' — a pull request is ready for review.' : '.') }
    : rcaStopped
      ? { color: 'var(--yellow)', bg: 'rgba(234,179,8,0.12)', icon: '🛑', head: `Stopped — ${VERDICT_LABEL[verdict] || verdict}`,
          line: rca?.rationale || job.rca?.rationale || 'The RCA agent judged this is not an app-code bug, so no code was changed.' }
      : cancelled
        ? { color: 'var(--muted)', bg: 'rgba(148,163,184,0.12)', icon: '⨯', head: 'Cancelled',
            line: 'The repair was cancelled before completion — no changes were committed.' }
        : { color: 'var(--red)', bg: 'rgba(239,68,68,0.12)', icon: '✕', head: 'Could not complete',
            line: job.error || 'The agent could not produce a verified fix — see the technical details.' };

  const evidence = [
    { label: 'Docs & specs read', value: docsRead, color: 'var(--accent2)', anchor: 'sec-rca' },
    { label: 'Code sections examined', value: codeChunks, color: 'var(--accent)', anchor: 'sec-retrieve' },
    { label: 'Screenshots analysed', value: shots, color: 'var(--green)', anchor: 'sec-diagnose' },
  ];
  const evMax = Math.max(1, ...evidence.map(e => e.value));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Outcome hero */}
      <div className="card" style={{ padding: 18, background: outcome.bg, borderLeft: `4px solid ${outcome.color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 30 }}>{outcome.icon}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{outcome.head}</div>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
              <strong>{job.test_id || 'Test'}</strong> · {outcome.line}
            </div>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatTile label="Root cause" value={VERDICT_LABEL[effectiveVerdict] || effectiveVerdict}
          sub={patchVerified
            ? (patch?.root_cause ? patch.root_cause : 'verified by the build')
            : (rca?.confidence ? `${rca.confidence} confidence` : '')}
          color="var(--accent2)" onClick={() => onJump('sec-rca')} />
        <StatTile label="Files changed" value={fileChanged ? '1' : '0'}
          sub={fileChanged ? fileChanged.split(/[/\\]/).pop() : '—'} color="var(--accent)" onClick={() => onJump('sec-apply')} />
        <StatTile label="Lines changed" value={String(linesChanged)} sub="minimal patch"
          color="var(--purple, var(--accent))" onClick={() => onJump('sec-diagnose')} />
        <StatTile label="Build" value={build?.ok === true ? 'Passed' : build?.ok === false ? 'Failed' : '—'}
          sub={build?.ok === true ? 'tsc + vite' : 'verification gate'}
          color={build?.ok === false ? 'var(--red)' : 'var(--green)'} onClick={() => onJump('sec-build')} />
      </div>
      {rcaDisagreed && (
        <div className="text-muted" style={{ fontSize: 11.5, marginTop: -6 }}>
          Note: the RCA agent's initial read was “{VERDICT_LABEL[verdict] || verdict}” (advisory,
          {rca?.confidence ? ` ${rca.confidence} confidence` : ''}), but it did not halt the pipeline, and the
          code-fixing agent produced a fix that passed the build — so the verified root cause is a code bug.
        </div>
      )}

      {/* Pipeline stepper */}
      <SummaryCard title="What the agent did, step by step" onJump={() => onJump('sec-rca')} linkLabel="See each stage →">
        <SummaryStepper job={job} stages={stages} onJump={onJump} />
      </SummaryCard>

      {/* Evidence + confidence side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <SummaryCard title="Evidence the agent examined" onJump={() => onJump('sec-retrieve')} linkLabel="View the evidence →">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            {evidence.map(e => (
              <BarRow key={e.label} label={e.label} value={e.value} max={evMax} color={e.color}
                onClick={() => onJump(e.anchor)} />
            ))}
          </div>
        </SummaryCard>

        <SummaryCard title="Diagnostic confidence" onJump={() => onJump('sec-diagnose')} linkLabel="How the fix was found →">
          <div style={{ display: 'flex', gap: 20, justifyContent: 'space-around', alignItems: 'center', paddingTop: 6 }}>
            <Ring pct={confPct(rca?.confidence)} label="Root-cause" caption={rca?.confidence || '—'} color="var(--accent2)" />
            <Ring pct={confPct(patch?.confidence)} label="Fix" caption={patch?.confidence || '—'} color="var(--green)" />
          </div>
        </SummaryCard>
      </div>

      {/* The fix at a glance */}
      {patch && (
        <SummaryCard title="The fix, at a glance" onJump={() => onJump('sec-diagnose')} linkLabel="See what was sent to Claude →">
          <div style={{ fontSize: 13, marginBottom: 6 }}>💡 {patch.explanation}</div>
          {patch.root_cause && <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Root cause: {patch.root_cause}</div>}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10,
            fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto' }}>
            <div style={{ color: 'var(--red)' }}>- {patch.find}</div>
            <div style={{ color: 'var(--green)' }}>+ {patch.replace}</div>
          </div>
        </SummaryCard>
      )}
    </div>
  );
}

function SummaryCard({ title, children, onJump, linkLabel }: {
  title: string; children: ReactNode; onJump: () => void; linkLabel: string;
}) {
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <button onClick={onJump} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11,
          color: 'var(--accent)', padding: 0, whiteSpace: 'nowrap' }}>{linkLabel}</button>
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, color, onClick }: {
  label: string; value: string; sub?: string; color: string; onClick?: () => void;
}) {
  return (
    <div className="card" onClick={onClick} style={{ padding: 12, cursor: onClick ? 'pointer' : 'default',
      borderTop: `3px solid ${color}` }}>
      <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 3, lineHeight: 1.15 }}>{value}</div>
      {sub && <div className="text-muted" style={{ fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  );
}

function SummaryStepper({ job, stages, onJump }: {
  job: RepairJob; stages: Record<string, RepairStage>; onJump: (a: string) => void;
}) {
  const running = job.status === 'pending' || job.status === 'running' || job.status === 'cancelling';
  const visStages = visibleStages(stages);
  const firstIncomplete = visStages.findIndex(s => {
    const st = stages[s.key]?.status; return st !== 'done' && st !== 'warn';
  });
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {visStages.map((meta, i) => {
        const kind = statusOf(stages[meta.key], running && i === firstIncomplete);
        const dot = DOT[kind];
        return (
          <button key={meta.key} onClick={() => onJump(`sec-${meta.key}`)} title={`${meta.label} — ${kind}`}
            style={{ flex: '1 1 92px', minWidth: 92, border: `1px solid ${dot.ring}`, borderRadius: 8, cursor: 'pointer',
              color: 'var(--text)',   // native <button> resets text colour → set it explicitly or the label is invisible
              background: kind === 'done' ? 'rgba(34,197,94,0.08)' : kind === 'failed' ? 'rgba(239,68,68,0.08)'
                : kind === 'running' ? 'rgba(59,130,246,0.10)' : 'var(--surface)',
              padding: '8px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 16 }}>{meta.icon}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.15, color: 'var(--text)' }}>{meta.label}</span>
            <span style={{ color: dot.color, fontSize: 12, fontWeight: 700 }}>{dot.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

function BarRow({ label, value, max, color, onClick }: {
  label: string; value: number; max: number; color: string; onClick?: () => void;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span>{label}</span><strong>{value}</strong>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: 'var(--bg)', overflow: 'hidden' }}>
        <div style={{ width: `${value > 0 ? Math.max(6, pct) : 0}%`, height: '100%', background: color, borderRadius: 5 }} />
      </div>
    </div>
  );
}

function Ring({ pct, label, caption, color }: { pct: number; label: string; caption: string; color: string }) {
  const r = 26, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={pct ? color : 'var(--border)'} strokeWidth="7"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 36 36)" />
        <text x="36" y="40" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--text)">{pct ? `${pct}%` : '—'}</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div className="text-muted" style={{ fontSize: 10.5, textTransform: 'capitalize' }}>{caption}</div>
    </div>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  if (!diff) return <div className="text-muted" style={{ fontSize: 12 }}>(no diff captured)</div>;
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
      padding: 10, fontFamily: MONO, fontSize: 12, lineHeight: 1.5, overflowX: 'auto', maxHeight: 260 }}>
      {diff.split('\n').map((ln, i) => {
        const c = ln.startsWith('+') && !ln.startsWith('+++') ? 'var(--green)'
          : ln.startsWith('-') && !ln.startsWith('---') ? 'var(--red)'
          : ln.startsWith('@@') ? 'var(--accent2)' : 'var(--muted)';
        return <div key={i} style={{ color: c, whiteSpace: 'pre' }}>{ln || ' '}</div>;
      })}
    </div>
  );
}
