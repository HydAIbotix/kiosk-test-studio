import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../api/client';
import type { RepairJob, RepairStage } from '../api/client';

/** The self-healing arm of defect intelligence. Repairs run AUTOMATICALLY: whenever a test
 *  fails, the backend fires the Auto-Repair agent — RAG (Chroma + HuggingFace) retrieves the
 *  offending code, Claude proposes one minimal patch, the agent applies it, type-checks, builds,
 *  and opens a PR. This page is a live DASHBOARD of those repairs (no manual trigger — the run
 *  that fails is the trigger). The standalone window popped by Live Monitor reuses the same
 *  pipeline view for a single repair. */

type StageMeta = { key: string; icon: string; label: string; sub: string };
const STAGES: StageMeta[] = [
  { key: 'retrieve', icon: '🔎', label: 'Retrieve context', sub: 'Chroma + HuggingFace RAG' },
  { key: 'diagnose', icon: '🧠', label: 'Diagnose the bug',  sub: 'Claude Opus 4.8' },
  { key: 'apply',    icon: '🩹', label: 'Apply the fix',     sub: 'single-occurrence patch' },
  { key: 'test',     icon: '🧪', label: 'Unit test',         sub: 'TypeScript type-check' },
  { key: 'build',    icon: '🏗️', label: 'Build',             sub: 'tsc -b + vite build' },
  { key: 'pr',       icon: '🔀', label: 'Raise PR',          sub: 'branch + commit + diff' },
];

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
    try { setIndex(await api.getRepairIndex()); } catch { /* backend down */ }
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
    pollRef.current = window.setInterval(refresh, 2500);
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
                ? 'Live repair triggered by a failed test — RAG finds the bug, Claude fixes it, then it builds and opens a PR.'
                : 'Runs automatically whenever a test fails: RAG finds the bug, Claude fixes it, then it type-checks, builds, and opens a PR. Every repair this session is listed below.'}
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
  const firstIncomplete = STAGES.findIndex(s => {
    const st = stages[s.key]?.status;
    return st !== 'done' && st !== 'warn';
  });
  const done = job.status === 'succeeded' || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  const buildStage = stages['build'];
  const prStage    = stages['pr'];
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
      <div style={{ padding: '8px 18px 18px' }}>
        {STAGES.map((meta, i) => {
          const st = stages[meta.key];
          const isActive = running && i === firstIncomplete;
          const kind = statusOf(st, isActive);
          return <StageRow key={meta.key} meta={meta} stage={st} kind={kind} last={i === STAGES.length - 1} />;
        })}
      </div>

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
    pending:    ['badge-muted',  'Pending'],
    running:    ['badge-blue',   '◐ Running'],
    cancelling: ['badge-yellow', '◐ Cancelling…'],
    cancelled:  ['badge-muted',  '⨯ Cancelled'],
    succeeded:  ['badge-green',  '✓ Succeeded'],
    completed:  ['badge-yellow', 'Completed'],
    failed:     ['badge-red',    '✕ Failed'],
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
