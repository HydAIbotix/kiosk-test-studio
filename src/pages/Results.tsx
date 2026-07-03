import { useEffect, useState } from 'react';
import { api, type Run, type RunDetail, type StepResult, type Defect } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import StepShots from '../components/StepShots';

export default function Results() {
  const [runs,    setRuns]   = useState<Run[]>([]);
  const [detail,  setDetail] = useState<RunDetail | null>(null);
  const [selected,setSel]    = useState<string | null>(null);
  const [loading, setLoad]   = useState(true);
  const [defects, setDefects]= useState<Defect[]>([]);

  useEffect(() => { api.getRuns().then(r => { setRuns(r); setLoad(false); }); }, []);

  const viewRun = (run_id: string) => {
    setSel(run_id);
    api.getRun(run_id).then(setDetail);
    api.getRunDefects(run_id).then(setDefects).catch(() => setDefects([]));
  };

  return (
    <div>
      <div className="grid-2">
        {/* Run list */}
        <div className="card">
          <div className="section-title">All Runs ({runs.length})</div>
          {loading ? <p className="text-muted">Loading…</p> : (
            <div className="table-wrap" style={{ maxHeight: 600, overflowY: 'auto', marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Run ID</th><th>Kiosk</th><th>Mode</th><th>Status</th>
                    <th>Result</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.run_id}
                      style={{ cursor: 'pointer', background: selected === r.run_id ? 'var(--surface2)' : undefined }}
                      onClick={() => viewRun(r.run_id)}>
                      <td className="monospace text-accent" style={{ fontSize: 11 }}>{r.run_id.slice(-10)}</td>
                      <td>{r.kiosk_id}</td>
                      <td><span className="tag">{r.mode}</span></td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        {r.total > 0
                          ? <span><span className="text-green">{r.passed}</span><span className="text-muted">/</span>{r.total}</span>
                          : '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="card">
          {detail ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <div>
                  <div className="monospace text-accent" style={{ fontSize: 11 }}>{detail.run_id}</div>
                  <div style={{ fontWeight: 600 }}>{detail.kiosk_id} / {detail.robot_id}</div>
                </div>
                <span className="spacer" />
                <StatusBadge status={detail.status} />
              </div>

              <div className="grid-3" style={{ gap: 8, marginBottom: 14 }}>
                <Tile label="Total"   value={detail.total} />
                <Tile label="Passed"  value={detail.passed} color="var(--green)" />
                <Tile label="Failed"  value={detail.failed} color={detail.failed > 0 ? 'var(--red)' : undefined} />
              </div>

              <div className="section-title">Test Results ({detail.results.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxHeight: 420, overflowY: 'auto' }}>
                {detail.results.map(r => (
                  <ResultCard key={r.test_id} result={r} runId={detail.run_id} defect={defects.find(d => d.test_id === r.test_id)} />
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ padding: '50px 0' }}>
              <p>Select a run to see step-level results.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--red)', high: '#f97316', medium: 'var(--yellow)', low: 'var(--muted)',
};

function ResultCard({ result, runId, defect }: { result: RunDetail['results'][0]; runId: string; defect?: Defect }) {
  const [open, setOpen] = useState(false);
  const passed = result.step_results?.filter(s => s.success).length ?? 0;
  const total  = result.step_results?.length ?? 0;
  return (
    <div className="card card-sm" style={{ borderColor: result.outcome === 'passed' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }}>
      <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <StatusBadge status={result.outcome} />
        <span className="monospace" style={{ fontSize: 11 }}>{result.test_id}</span>
        <span style={{ fontSize: 12, flex: 1, color: 'var(--muted)' }}>{result.summary?.replace(`${result.test_id} `, '')}</span>
        {defect && (
          <a href={defect.jira_url} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, color: SEVERITY_COLOR[defect.severity] ?? 'var(--red)', fontWeight: 600, textDecoration: 'none', border: `1px solid ${SEVERITY_COLOR[defect.severity] ?? 'var(--red)'}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
            {defect.jira_key} ↗
          </a>
        )}
        <span style={{ fontSize: 11 }}>{passed}/{total}</span>
        <span className="text-muted">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {defect && (
            <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5 }}>
              <div className="row" style={{ marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>DEFECT</span>
                <span style={{ fontSize: 11, color: SEVERITY_COLOR[defect.severity] ?? 'var(--red)', fontWeight: 600, textTransform: 'uppercase' }}>{defect.severity}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{defect.priority}</span>
                <span className="spacer" />
                <a href={defect.jira_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 600 }}>{defect.jira_key} ↗</a>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{defect.title}</div>
              {defect.root_cause && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}><strong>Root cause:</strong> {defect.root_cause}</div>}
              {defect.probable_fix && <div style={{ fontSize: 11, color: 'var(--muted)' }}><strong>Fix:</strong> {defect.probable_fix}</div>}
            </div>
          )}
          {result.step_results?.map((s, i) => <StepRow key={i} step={s} idx={i+1} runId={runId} />)}
          {result.vision_summary && (
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{result.vision_summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({ step, idx, runId }: { step: StepResult; idx: number; runId: string }) {
  return (
    <div className="step-row">
      <span className="step-icon">{step.success ? '✓' : '✗'}</span>
      <div className="step-text">
        <div>{step.step}</div>
        {step.note && <div className="step-meta">{step.note}</div>}
        {step.observation && !step.success && (
          <div className="step-meta" style={{ color: 'var(--red)' }}>{step.observation}</div>
        )}
        {step.expected_screen && <div className="step-meta">expected: {step.expected_screen} → actual: {step.actual_screen}</div>}
        {step.method && <span className="tag" style={{ marginTop: 2 }}>{step.method}</span>}
        <StepShots runId={runId} step={step} />
      </div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="metric" style={{ padding: '10px 12px' }}>
      <div className="metric-label">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}
