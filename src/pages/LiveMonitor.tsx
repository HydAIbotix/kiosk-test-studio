import { useEffect, useRef, useState } from 'react';
import { api, runWs, type Run, type RunDetail } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import StepShots from '../components/StepShots';

type FeedLine = { ts: string; text: string; cls: string };

export default function LiveMonitor() {
  const [runs,      setRuns]    = useState<Run[]>([]);
  const [activeRun, setActive]  = useState<string | null>(null);
  const [run,       setRun]     = useState<RunDetail | null>(null);
  const [feed,      setFeed]    = useState<FeedLine[]>([]);
  const [wsOpen,    setWsOpen]  = useState(false);
  const wsRef   = useRef<WebSocket | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const loadRuns = () => api.getRuns().then(r => { setRuns(r); return r; });

  useEffect(() => {
    loadRuns();
    // Periodically refresh the run list so status badges stay in sync
    const t = setInterval(loadRuns, 4000);
    return () => clearInterval(t);
  }, []);

  const watchRun = (run_id: string) => {
    wsRef.current?.close();
    setFeed([]);
    setActive(run_id);

    // Load full detail (includes results + error)
    api.getRun(run_id).then(r => setRun(r));

    const ws = runWs(run_id, (ev) => {
      const e = ev as {
        event: string; test_id?: string; outcome?: string; error?: string;
        vision_summary?: string; failed_steps?: string[];
        step_index?: number; step?: string; success?: boolean; note?: string;
        summary?: string; count?: number; defects?: {jira_key:string;severity:string;title:string}[];
        [k: string]: unknown;
      };

      let text = JSON.stringify(ev);
      let cls  = 'line-info';

      if (e.event === 'test_started') {
        text = `▶ [${e.test_id}]  ${e.summary ?? ''}`;
        cls  = 'line-info';
      } else if (e.event === 'step_result') {
        const icon = e.success ? '  ✓' : '  ✗';
        text = `${icon} step ${e.step_index}: ${e.step}`;
        cls  = e.success ? 'line-pass' : 'line-fail';
        if (e.note) {
          setFeed(f => [...f.slice(-200),
            { ts: new Date().toLocaleTimeString(), text, cls },
            { ts: '', text: `         ${e.note}`, cls: 'line-muted' },
          ]);
          return;
        }
      } else if (e.event === 'test_result') {
        const badge = e.outcome === 'passed' ? '✓ PASS' : '✗ FAIL';
        text = `  [${e.test_id}]  ${badge}`;
        cls  = e.outcome === 'passed' ? 'line-pass' : 'line-fail';
        if (e.outcome !== 'passed') {
          const lines: FeedLine[] = [{ ts: new Date().toLocaleTimeString(), text, cls }];
          if (e.vision_summary) lines.push({ ts: '', text: `       → ${e.vision_summary}`, cls: 'line-fail' });
          (e.failed_steps ?? []).forEach((s: string) => lines.push({ ts: '', text: `       ✗ ${s}`, cls: 'line-fail' }));
          setFeed(f => [...f.slice(-200), ...lines]);
          api.getRun(run_id).then(r => setRun(r));
          return;
        }
      } else if (e.event === 'defects_ready') {
        text = `  Defect analysis: ${e.count} defect(s) filed`;
        cls  = 'line-info';
        const lines: FeedLine[] = [{ ts: new Date().toLocaleTimeString(), text, cls }];
        (e.defects ?? []).forEach((d: {jira_key:string; severity:string; title:string}) => {
          lines.push({ ts: '', text: `  [${d.jira_key}] ${d.severity.toUpperCase()} — ${d.title}`, cls: 'line-fail' });
        });
        setFeed(f => [...f.slice(-200), ...lines]);
        return;
      } else if (e.event === 'run_started')   { text = '▶ Run started'; }
      else if (e.event === 'run_completed')   { text = '✓ Run completed'; cls = 'line-pass'; }
      else if (e.event === 'run_error')       { text = `✗ Error: ${e.error}`; cls = 'line-fail'; }
      else if (e.event === 'suite_completed') { text = '  Suite done'; }

      setFeed(f => [...f.slice(-200), { ts: new Date().toLocaleTimeString(), text, cls }]);
      api.getRun(run_id).then(r => setRun(r));

      if (e.event === 'run_completed' || e.event === 'run_error') {
        loadRuns();
      }
    });

    ws.onopen  = () => setWsOpen(true);
    ws.onclose = () => setWsOpen(false);
    wsRef.current = ws;
  };

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed]);

  useEffect(() => () => wsRef.current?.close(), []);

  // Auto-watch the latest running suite
  useEffect(() => {
    const running = runs.find(r => r.status === 'running');
    if (running && !activeRun) watchRun(running.run_id);
  }, [runs]);

  const passRate = run && run.total > 0 ? Math.round((run.passed / run.total) * 100) : null;
  const isDone   = run?.status === 'completed' || run?.status === 'failed';

  return (
    <div>
      <div className="grid-2 section">
        {/* Run selector */}
        <div className="card">
          <div className="section-title">Active & Recent Runs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
            {runs.length === 0 && <p className="text-muted">No runs yet.</p>}
            {runs.slice(0, 20).map(r => (
              <button key={r.run_id} className="card card-sm"
                style={{ cursor: 'pointer', textAlign: 'left', border: activeRun === r.run_id ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                onClick={() => watchRun(r.run_id)}>
                <div className="row">
                  <StatusBadge status={r.status} />
                  <span className="monospace text-accent" style={{ fontSize: 11 }}>{r.run_id.slice(-10)}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>{r.kiosk_id} / {r.robot_id}</span>
                  <span className="spacer" />
                  <span style={{ fontSize: 11 }}>{r.passed}/{r.total}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Selected run stats */}
        <div className="card">
          {run ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <div>
                  <div className="monospace text-accent" style={{ fontSize: 11 }}>{run.run_id}</div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>{run.kiosk_id} / {run.robot_id}</div>
                </div>
                <span className="spacer" />
                <StatusBadge status={run.status} />
                {run.status === 'running' && <span className="blink text-muted" style={{ fontSize: 12 }}>LIVE</span>}
              </div>

              <div className="grid-3" style={{ gap: 8, marginBottom: 14 }}>
                <Tile label="Total"  value={run.total} />
                <Tile label="Passed" value={run.passed} color="var(--green)" />
                <Tile label="Failed" value={run.failed} color={run.failed > 0 ? 'var(--red)' : undefined} />
              </div>

              {run.total > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="text-muted" style={{ fontSize: 11 }}>Pass rate</span>
                    <span className="spacer" />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{passRate}%</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill progress-green" style={{ width: `${passRate}%` }} />
                  </div>
                </div>
              )}

              {/* Error banner — shown for failed runs */}
              {run.status === 'failed' && run.error && (
                <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>✗ Run failed</div>
                  <div style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'monospace', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {run.error}
                  </div>
                </div>
              )}

              <div className="section-title" style={{ marginBottom: 6 }}>WebSocket Status</div>
              <div className="row">
                <span className={`dot ${wsOpen ? 'dot-green blink' : 'dot-muted'}`} />
                <span style={{ fontSize: 12 }}>{wsOpen ? 'Connected — streaming live' : isDone ? 'Run complete' : 'Not connected'}</span>
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <p>Select a run to monitor.</p>
            </div>
          )}
        </div>
      </div>

      {/* Live event feed */}
      <div className="card section">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="section-title" style={{ marginBottom: 0 }}>Live Event Feed</span>
          <span className="spacer" />
          <button className="btn btn-sm btn-secondary" onClick={() => setFeed([])}>Clear</button>
          <button className="btn btn-sm btn-secondary"
            onClick={() => loadRuns().then(rs => { const r = rs.find(x => x.status === 'running'); if (r) watchRun(r.run_id); })}>
            ↻ Refresh
          </button>
        </div>
        <div className="live-feed" ref={feedRef}>
          {feed.length === 0 ? (
            <span className="line-muted">
              {activeRun && isDone
                ? 'Events were streamed during the run — see Stored Results below.'
                : 'Select a running suite to see live events…'}
            </span>
          ) : feed.map((l, i) => (
            <div key={i} className={l.cls}>
              {l.ts && <span style={{ color: 'var(--muted)', marginRight: 8 }}>{l.ts}</span>}
              {l.text}
            </div>
          ))}
        </div>
      </div>

      {/* Stored results — shown when run is done and has TC-level results */}
      {run && isDone && run.results && run.results.length > 0 && (
        <div className="card">
          <div className="section-title">Stored Results ({run.results.length} test cases)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {run.results.map(r => (
              <StoredResult key={r.test_id} result={r} runId={run.run_id} />
            ))}
          </div>
        </div>
      )}

      {/* No-results explanation when run failed before any TC ran */}
      {run && run.status === 'failed' && run.results?.length === 0 && run.error && (
        <div className="card">
          <div className="section-title">No Test Cases Ran</div>
          <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            The run terminated before executing any test case. This usually means the test filter
            matched nothing, the Excel path is wrong, or the backend raised an early error.
            See the error message above for details.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Stored result row ──────────────────────────────────────────────────────────

import type { TestResultDetail } from '../api/client';

function StoredResult({ result, runId }: { result: TestResultDetail; runId: string }) {
  const [open, setOpen] = useState(false);
  const passed = result.outcome === 'passed';
  const steps  = result.step_results ?? [];
  const failedSteps = steps.filter(s => !s.success);

  return (
    <div style={{ border: `1px solid ${passed ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: 6, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: passed ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
        <span style={{ fontSize: 14 }}>{passed ? '✓' : '✗'}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent2)' }}>{result.test_id}</span>
        <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{result.summary}</span>
        {!passed && failedSteps.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--red)' }}>{failedSteps.length} step{failedSteps.length > 1 ? 's' : ''} failed</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
          {result.vision_summary && (
            <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 5, fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>VISION SUMMARY</span>
              {result.vision_summary}
            </div>
          )}
          {steps.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>STEPS ({steps.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {steps.map((s, i) => (
                  <div key={i} style={{ fontSize: 12 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: s.success ? 'var(--green)' : 'var(--red)', minWidth: 14, flexShrink: 0 }}>{s.success ? '✓' : '✗'}</span>
                      <span style={{ color: 'var(--text)', flex: 1 }}>{s.step}</span>
                      {s.note && <span style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 240 }}>{s.note}</span>}
                    </div>
                    {s.observation && !s.success && (
                      <div style={{ fontSize: 11, color: 'var(--red)', margin: '2px 0 0 22px' }}>{s.observation}</div>
                    )}
                    <div style={{ marginLeft: 22 }}><StepShots runId={runId} step={s} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {steps.length === 0 && !result.vision_summary && (
            <p className="text-muted" style={{ fontSize: 12 }}>No step detail stored for this result.</p>
          )}
        </div>
      )}
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
