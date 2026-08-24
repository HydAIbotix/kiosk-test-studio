import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api/client';
import type { RepairJob, RepairStage } from '../api/client';

/** The self-healing arm of defect intelligence: RAG (Chroma + HuggingFace) retrieves the
 *  offending code, Claude proposes one minimal patch, the agent applies it, lints, builds,
 *  and prepares a PR. Every stage streams here live. */

type StageMeta = { key: string; icon: string; label: string; sub: string };
const STAGES: StageMeta[] = [
  { key: 'retrieve', icon: '🔎', label: 'Retrieve context', sub: 'Chroma + HuggingFace RAG' },
  { key: 'diagnose', icon: '🧠', label: 'Diagnose the bug',  sub: 'Claude Opus 4.8' },
  { key: 'apply',    icon: '🩹', label: 'Apply the fix',     sub: 'single-occurrence patch' },
  { key: 'test',     icon: '🧪', label: 'Unit test',         sub: 'TypeScript type-check' },
  { key: 'build',    icon: '🏗️', label: 'Build',             sub: 'tsc -b + vite build' },
  { key: 'pr',       icon: '🔀', label: 'Raise PR',          sub: 'branch + commit + diff' },
];

const DEFAULT_FAILURE =
  'TC-RPS-001 (RPS login) failed: on the Sign In screen the Sign In button never becomes ' +
  'enabled, so valid credentials cannot be submitted and the user is stuck on the login page. ' +
  'Fix the sign-in form gating so a filled email + password lets the user submit and log in.';

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

function mergedStages(job: RepairJob | null): Record<string, RepairStage> {
  if (!job) return {};
  return { ...(job.stages || {}), ...(job.result?.stages || {}) };
}

export default function AutoRepair({ standaloneRepairId }: { standaloneRepairId?: string } = {}) {
  const [failure, setFailure]   = useState(DEFAULT_FAILURE);
  const [testId,  setTestId]    = useState('TC-RPS-001');
  const [job,     setJob]       = useState<RepairJob | null>(null);
  const [running, setRunning]   = useState(false);
  const [error,   setError]     = useState('');
  const [index,   setIndex]     = useState<{building: boolean; exists: boolean; message: string} | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [prBusy,  setPrBusy]    = useState(false);
  const [prConfirm, setPrConfirm] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);

  const refreshIndex = async () => {
    try { setIndex(await api.getRepairIndex()); } catch { /* backend down */ }
  };
  useEffect(() => { refreshIndex(); return () => clearInterval(pollRef.current); }, []);

  const pollJob = (repair_id: string) => {
    const poll = async () => {
      try {
        const j = await api.getRepair(repair_id);
        setJob(j);
        if (j.status === 'pending' || j.status === 'running') {
          pollRef.current = window.setTimeout(poll, 1000);
        } else {
          setRunning(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Repair polling failed');
        setRunning(false);
      }
    };
    poll();
  };

  // Standalone window (?repair=<id>): attach to the already-running auto-repair job and stream it.
  useEffect(() => {
    if (standaloneRepairId) { setRunning(true); pollJob(standaloneRepairId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standaloneRepairId]);

  const rebuildIndex = async () => {
    setIndexBusy(true);
    try {
      await api.buildRepairIndex();
      // poll index status until it finishes building
      const tick = async () => {
        const s = await api.getRepairIndex();
        setIndex(s);
        if (!s.building) setIndexBusy(false);
        else setTimeout(tick, 1500);
      };
      tick();
    } catch (e) { setError(e instanceof Error ? e.message : 'Index build failed'); setIndexBusy(false); }
  };

  const start = async () => {
    setError(''); setJob(null); setRunning(true); setPrConfirm(false);
    try {
      const { repair_id } = await api.startRepair({ failure, test_id: testId });
      pollJob(repair_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the repair job');
      setRunning(false);
    }
  };

  const openPr = async () => {
    if (!job) return;
    setPrBusy(true); setError('');
    try {
      const outcome = await api.openRepairPr(job.repair_id);
      setJob(await api.getRepair(job.repair_id));
      if (!outcome.opened) setError(`PR not raised: ${outcome.output || 'see server log'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Open PR failed');
    } finally { setPrBusy(false); setPrConfirm(false); }
  };

  const stages = mergedStages(job);
  // Determine which stage is "active" (first without a terminal status while running)
  const firstIncomplete = STAGES.findIndex(s => {
    const st = stages[s.key]?.status;
    return st !== 'done' && st !== 'warn';
  });
  const done = job && (job.status === 'succeeded' || job.status === 'completed' || job.status === 'failed');
  const buildStage = stages['build'];
  const prStage    = stages['pr'];
  const succeeded  = job?.status === 'succeeded' || (buildStage?.ok === true);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Hero ── */}
      <div className="card" style={{ padding: 20, background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(59,130,246,0.05))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 30 }}>🛠️</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>Auto-Repair Agent</h2>
            <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              A failed test comes in → the agent finds the bug with RAG, fixes it with Claude,
              lints, builds, and opens a pull request. Self-healing defect intelligence.
            </p>
          </div>
          <IndexChip index={index} busy={indexBusy} onRebuild={rebuildIndex} />
        </div>
      </div>

      {/* ── Input (hidden in the standalone auto-repair window) ── */}
      {!standaloneRepairId && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 14 }}>
            <div>
              <label className="form-label">Failed test / defect description</label>
              <textarea className="form-input form-textarea" value={failure}
                onChange={e => setFailure(e.target.value)} rows={3} disabled={running} />
            </div>
            <div>
              <label className="form-label">Test ID</label>
              <input className="form-input" value={testId} onChange={e => setTestId(e.target.value)} disabled={running} />
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }}
                onClick={start} disabled={running || !failure.trim()}>
                {running ? '◐ Repairing…' : '▶ Run Auto-Repair'}
              </button>
            </div>
          </div>
          {index && !index.exists && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--yellow)' }}>
              ⚠ RAG index not built yet — click “Rebuild index” above before running.
            </p>
          )}
          {error && <p style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>✕ {error}</p>}
        </div>
      )}
      {standaloneRepairId && job && (
        <div className="card" style={{ padding: 14 }}>
          <div className="text-muted" style={{ fontSize: 12 }}>Auto-triggered by a failed test</div>
          <div style={{ fontSize: 13, marginTop: 4 }}><strong>{job.test_id}</strong> — {job.failure}</div>
          {error && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>✕ {error}</p>}
        </div>
      )}

      {/* ── Pipeline ── */}
      {job && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Repair pipeline
              <span className="text-muted" style={{ fontWeight: 400 }}> · {job.repair_id}</span>
            </div>
            <OverallBadge status={job.status} />
          </div>

          <div style={{ padding: '8px 18px 18px' }}>
            {STAGES.map((meta, i) => {
              const st = stages[meta.key];
              const isActive = running && i === firstIncomplete;
              const kind = statusOf(st, isActive);
              return (
                <StageRow key={meta.key} meta={meta} stage={st} kind={kind}
                  last={i === STAGES.length - 1} />
              );
            })}
          </div>

          {/* ── Result banner ── */}
          {done && (
            <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)',
              background: succeeded ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}>
              {succeeded ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="badge badge-green">✓ Fixed &amp; built</span>
                  <span className="text-muted" style={{ fontSize: 13 }}>
                    The agent repaired {stages['apply']?.file || 'the code'} and the build passed.
                    {prStage?.prepared && ' A PR branch is ready.'}
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
                    <a className="badge badge-accent" style={{ marginLeft: 'auto', textDecoration: 'none' }}
                      href={prStage.opened.url} target="_blank" rel="noreferrer">↗ View PR</a>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge badge-red">✕ Repair incomplete</span>
                  <span className="text-muted" style={{ fontSize: 13 }}>
                    {job.error || 'The build did not pass — see the stage output above.'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IndexChip({ index, busy, onRebuild }: {
  index: {building: boolean; exists: boolean; message: string} | null; busy: boolean; onRebuild: () => void;
}) {
  const label = !index ? 'unknown' : index.building || busy ? 'building…' : index.exists ? 'ready' : 'not built';
  const cls = !index ? 'badge-muted' : index.building || busy ? 'badge-blue' : index.exists ? 'badge-green' : 'badge-yellow';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <span className={`badge ${cls}`}>RAG index: {label}</span>
      <button className="btn btn-secondary btn-sm" onClick={onRebuild} disabled={busy || index?.building}>
        {busy || index?.building ? '◐ Indexing…' : '↻ Rebuild index'}
      </button>
    </div>
  );
}

function OverallBadge({ status }: { status: RepairJob['status'] }) {
  const map: Record<RepairJob['status'], [string, string]> = {
    pending:   ['badge-muted',  'Pending'],
    running:   ['badge-blue',   '◐ Running'],
    succeeded: ['badge-green',  '✓ Succeeded'],
    completed: ['badge-yellow', 'Completed'],
    failed:    ['badge-red',    '✕ Failed'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return <span className={`badge ${cls}`}>{label}</span>;
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
          <span className="text-muted" style={{ fontSize: 11 }}>{meta.sub}</span>
          {kind === 'running' && <span className="badge badge-blue" style={{ marginLeft: 'auto' }}>working…</span>}
          {hasDetail && <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{open ? '▲' : '▼'}</span>}
        </div>
        {open && stage && <StageDetail stageKey={meta.key} stage={stage} />}
      </div>
    </div>
  );
}

function StageDetail({ stageKey, stage }: { stageKey: string; stage: RepairStage }) {
  const box: CSSProperties = {
    marginTop: 8, background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, padding: 10, fontFamily: 'monospace', fontSize: 12,
    whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 280,
  };

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
            <pre style={{ margin: 0, padding: 10, fontSize: 11, maxHeight: 150, overflow: 'auto' }}>{h.snippet}</pre>
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

function DiffBlock({ diff }: { diff: string }) {
  if (!diff) return <div className="text-muted" style={{ fontSize: 12 }}>(no diff captured)</div>;
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
      padding: 10, fontFamily: 'monospace', fontSize: 11, overflowX: 'auto', maxHeight: 260 }}>
      {diff.split('\n').map((ln, i) => {
        const c = ln.startsWith('+') && !ln.startsWith('+++') ? 'var(--green)'
          : ln.startsWith('-') && !ln.startsWith('---') ? 'var(--red)'
          : ln.startsWith('@@') ? 'var(--accent2)' : 'var(--muted)';
        return <div key={i} style={{ color: c, whiteSpace: 'pre' }}>{ln || ' '}</div>;
      })}
    </div>
  );
}
