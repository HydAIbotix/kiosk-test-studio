import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api/client';
import type { Run, RepairJob, AppMap, Defect } from '../api/client';

/** Agentic View — the command-center / "big monitor" view of the whole autonomous pipeline.
 *  It reads live backend state (runs, defects, repairs, app map) and shows every agent as a node
 *  in a flowing pipeline: App Explorer → Test Runner → Defect Intelligence → Auto-Repair, backed by
 *  the Vision and Supervisor agents. Purely a visualization — it starts nothing and changes no state,
 *  so it can never regress existing functionality. */

type AgentStatus = 'idle' | 'active' | 'done' | 'flag' | 'error';

const STATUS_META: Record<AgentStatus, { label: string; color: string; ring: string; glow: string }> = {
  idle:   { label: 'Idle',        color: 'var(--muted)',  ring: 'var(--border)',            glow: 'transparent' },
  active: { label: 'Working',     color: 'var(--accent2)', ring: 'var(--accent)',           glow: 'rgba(99,102,241,0.55)' },
  done:   { label: 'Complete',    color: 'var(--green)',  ring: 'var(--green)',             glow: 'rgba(34,197,94,0.45)' },
  flag:   { label: 'Findings',    color: 'var(--yellow)', ring: 'var(--yellow)',            glow: 'rgba(245,158,11,0.45)' },
  error:  { label: 'Attention',   color: 'var(--red)',    ring: 'var(--red)',               glow: 'rgba(239,68,68,0.45)' },
};

type AgentCard = {
  key: string; icon: string; name: string; role: string;
  status: AgentStatus; metric: string; sub: string; engine: string;
};

function relTime(iso?: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function AgenticView() {
  const [runs, setRuns]       = useState<Run[]>([]);
  const [repairs, setRepairs] = useState<RepairJob[]>([]);
  const [appMap, setAppMap]   = useState<AppMap | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [, setTick]           = useState(0);   // bump on each poll to refresh relative times
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [r, rp, am] = await Promise.all([
          api.getRuns().catch(() => [] as Run[]),
          api.listRepairs().catch(() => [] as RepairJob[]),
          api.getAppMap().catch(() => null),
        ]);
        if (!alive) return;
        const sortedRuns = [...r].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        setRuns(sortedRuns);
        setRepairs(rp);
        setAppMap(am);
        setConnected(true);
        const latest = sortedRuns[0];
        if (latest) {
          try { setDefects(await api.getRunDefects(latest.run_id)); } catch { setDefects([]); }
        } else setDefects([]);
      } catch {
        if (alive) setConnected(false);
      }
      if (alive) setTick(t => t + 1);
    };
    load();
    timer.current = window.setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer.current); };
  }, []);

  // ── derive metrics ──
  const m = useMemo(() => {
    const screens = appMap?.screens ? Object.keys(appMap.screens).length : 0;
    const apps    = appMap?.apps ? Object.keys(appMap.apps).length : 0;
    const totalTests  = runs.reduce((s, r) => s + (r.total || 0), 0);
    const passed      = runs.reduce((s, r) => s + (r.passed || 0), 0);
    const failed      = runs.reduce((s, r) => s + (r.failed || 0), 0);
    const passRate    = passed + failed > 0 ? passed / (passed + failed) : 0;
    const runningRun  = runs.find(r => r.status === 'running') || null;
    const latestRun   = runs[0] || null;
    const repairsDone = repairs.filter(r => r.status === 'succeeded').length;
    const repairRunning = repairs.find(r => r.status === 'pending' || r.status === 'running') || null;
    const latestRepair = repairs[0] || null;
    return { screens, apps, totalTests, passed, failed, passRate, runningRun, latestRun,
             repairsDone, repairRunning, latestRepair };
  }, [runs, repairs, appMap, defects]);

  // ── derive agent states ──
  const explorerStatus: AgentStatus = m.screens > 0 ? 'done' : 'idle';
  const runnerStatus: AgentStatus = m.runningRun ? 'active'
    : m.latestRun ? (m.latestRun.status === 'failed' ? 'error' : 'done') : 'idle';
  const defectStatus: AgentStatus = defects.length > 0 ? 'flag'
    : m.latestRun && m.latestRun.failed > 0 ? 'active' : (m.latestRun ? 'done' : 'idle');
  const repairStatus: AgentStatus = m.repairRunning ? 'active'
    : m.latestRepair ? (m.latestRepair.status === 'succeeded' ? 'done'
        : m.latestRepair.status === 'failed' ? 'error' : 'flag') : 'idle';

  const agents: AgentCard[] = [
    { key: 'explorer', icon: '🧭', name: 'App Explorer', role: 'Autonomously crawls the kiosk & maps every screen',
      engine: 'LangGraph · Claude vision', status: explorerStatus,
      metric: `${m.screens}`, sub: `screens across ${m.apps} app${m.apps === 1 ? '' : 's'}` },
    { key: 'runner', icon: '⚙️', name: 'Test Runner', role: 'Plans & executes test cases (3-tier, 0-LLM steady state)',
      engine: 'LangGraph · plan cache + Claude', status: runnerStatus,
      metric: m.runningRun ? 'LIVE' : `${m.passed}/${m.passed + m.failed}`,
      sub: m.runningRun ? `running ${m.runningRun.run_id}` : 'tests passed' },
    { key: 'defect', icon: '🔬', name: 'Defect Intelligence', role: 'Diagnoses failures & writes structured defects',
      engine: 'LangGraph · Claude Opus', status: defectStatus,
      metric: `${defects.length}`, sub: 'defects on latest run' },
    { key: 'repair', icon: '🛠️', name: 'Auto-Repair', role: 'RAG-finds the bug, Claude fixes it, builds & opens a PR',
      engine: 'LangGraph · Chroma + Claude', status: repairStatus,
      metric: `${m.repairsDone}`, sub: `of ${repairs.length} repair${repairs.length === 1 ? '' : 's'} fixed` },
  ];

  const activity = useMemo(() => buildActivity(runs, repairs), [runs, repairs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{KEYFRAMES}</style>

      {/* ── Hero band ── */}
      <div style={heroStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 40, filter: 'drop-shadow(0 0 12px rgba(99,102,241,0.6))' }}>◎</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '-0.5px', lineHeight: 1.1 }}>
              Agentic Command Center
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--muted)' }}>
              Five autonomous agents drive the kiosk QA lifecycle end-to-end — explore, test, diagnose, and self-heal.
            </p>
          </div>
          <LivePill connected={connected} />
        </div>
      </div>

      {/* ── Agent pipeline ── */}
      <div style={{ ...cardStyle, padding: '26px 22px' }}>
        <SectionLabel>Autonomous pipeline</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap', marginTop: 14 }}>
          {agents.map((a, i) => (
            <div key={a.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 220px', minWidth: 200 }}>
              <AgentNode agent={a} />
              {i < agents.length - 1 && <Connector active={a.status === 'done' || a.status === 'active' || a.status === 'flag'} />}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <SupportChip icon="👁️" name="Vision Agent" note="Tier-3 fallback — reads uncharted screens" />
          <SupportChip icon="🧵" name="Supervisor" note="Runs many robots in parallel" />
          <SupportChip icon="🤖" name="Robot Abstraction" note="demo → playwright → real arm, one I/O" />
        </div>
      </div>

      {/* ── Headline KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Kpi big={`${m.screens}`} label="Screens mapped" sub={`${m.apps} kiosk app${m.apps === 1 ? '' : 's'}`} accent="var(--accent2)" />
        <Kpi big={`${m.totalTests}`} label="Tests executed" sub={`${runs.length} run${runs.length === 1 ? '' : 's'}`} accent="#38bdf8" />
        <Kpi big={`${defects.length}`} label="Defects detected" sub="latest run" accent="var(--yellow)" />
        <Kpi big={`${m.repairsDone}`} label="Auto-repaired" sub={`${repairs.length} attempted`} accent="var(--green)" />
      </div>

      {/* ── Pass-rate + steady-state story + live feed ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(240px, 1fr) minmax(280px, 1.4fr)', gap: 14 }}>
        <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <SectionLabel>Test pass rate</SectionLabel>
          <Donut value={m.passRate} centerTop={`${Math.round(m.passRate * 100)}%`}
            centerSub={`${m.passed} / ${m.passed + m.failed}`} />
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <Legend color="var(--green)" label={`${m.passed} passed`} />
            <Legend color="var(--red)" label={`${m.failed} failed`} />
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
          <SectionLabel>Cost-aware autonomy</SectionLabel>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, background: 'linear-gradient(90deg,#22c55e,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            0-LLM
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
            Steady-state execution runs on cached plans + template matching — <strong style={{ color: 'var(--text)' }}>zero</strong> model
            calls. Claude is paid only for exploration, planning, and repair.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <span className="badge badge-green">Tier 1 · cache</span>
            <span className="badge badge-blue">Tier 2 · text plan</span>
            <span className="badge badge-accent">Tier 3 · vision</span>
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 18px 6px' }}><SectionLabel>Live activity</SectionLabel></div>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 260, padding: '4px 18px 16px' }}>
            {activity.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: '20px 0', textAlign: 'center' }}>
                Waiting for agent activity…
              </div>
            ) : activity.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0',
                borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 14 }}>{ev.icon}</span>
                <span style={{ flex: 1, fontSize: 13 }}>{ev.text}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{relTime(ev.at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── activity feed builder ──
type Ev = { icon: string; text: string; at?: string | null };
function buildActivity(runs: Run[], repairs: RepairJob[]): Ev[] {
  const evs: Ev[] = [];
  for (const r of runs.slice(0, 6)) {
    const icon = r.status === 'running' ? '🟢' : r.status === 'failed' ? '🔴' : '✅';
    evs.push({ icon, text: `Run ${r.run_id} — ${r.passed}✓ / ${r.failed}✗ (${r.status})`, at: r.created_at });
  }
  for (const rp of repairs.slice(0, 6)) {
    const icon = rp.status === 'succeeded' ? '🛠️' : rp.status === 'failed' ? '⚠️' : '⏳';
    evs.push({ icon, text: `Auto-Repair ${rp.test_id || rp.repair_id} — ${rp.status}`, at: rp.created_at });
  }
  return evs.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 9);
}

// ── sub-components ──

function AgentNode({ agent }: { agent: AgentCard }) {
  const s = STATUS_META[agent.status];
  const active = agent.status === 'active';
  return (
    <div style={{
      flex: 1, background: 'linear-gradient(160deg, var(--surface), var(--surface2))',
      border: `1px solid ${s.ring}`, borderRadius: 14, padding: '18px 16px',
      display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden',
      boxShadow: active ? `0 0 0 1px ${s.ring}, 0 8px 30px ${s.glow}` : `0 4px 16px rgba(0,0,0,0.25)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 46, height: 46, borderRadius: '50%', flexShrink: 0, fontSize: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${s.ring}`, color: s.color, background: 'var(--bg)',
          boxShadow: `0 0 14px ${s.glow}`,
          animation: active ? 'agpulse 1.6s ease-in-out infinite' : undefined,
        }}>{agent.icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: s.color,
            display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color,
              animation: active ? 'agblink 1s step-start infinite' : undefined }} />
            {s.label}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: s.color, lineHeight: 1 }}>{agent.metric}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{agent.sub}</span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text)', opacity: 0.85, lineHeight: 1.45 }}>{agent.role}</div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>{agent.engine}</div>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div style={{ width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="34" height="22" viewBox="0 0 34 22">
        <line x1="2" y1="11" x2="26" y2="11"
          stroke={active ? 'var(--accent)' : 'var(--border)'} strokeWidth="2"
          strokeDasharray="5 5"
          style={active ? { animation: 'agflow 0.8s linear infinite' } : undefined} />
        <path d="M24 5 L32 11 L24 17" fill="none"
          stroke={active ? 'var(--accent)' : 'var(--border)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function SupportChip({ icon, name, note }: { icon: string; name: string; note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)',
      border: '1px solid var(--border)', borderRadius: 10, padding: '9px 13px', flex: '1 1 220px' }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note}</div>
      </div>
    </div>
  );
}

function Kpi({ big, label, sub, accent }: { big: string; label: string; sub: string; accent: string }) {
  return (
    <div style={{ ...cardStyle, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 3, background: accent, opacity: 0.9 }} />
      <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, color: accent }}>{big}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function Donut({ value, centerTop, centerSub }: { value: number; centerTop: string; centerSub: string }) {
  const r = 54, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" style={{ margin: '6px 0' }}>
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--border)" strokeWidth="14" />
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--green)" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 75 75)"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      <text x="75" y="72" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--text)">{centerTop}</text>
      <text x="75" y="94" textAnchor="middle" fontSize="12" fill="var(--muted)">{centerSub}</text>
    </svg>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} /> {label}
    </span>
  );
}

function LivePill({ connected }: { connected: boolean | null }) {
  const ok = connected === true;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999,
      border: `1px solid ${ok ? 'var(--green)' : 'var(--border)'}`,
      background: ok ? 'rgba(34,197,94,0.1)' : 'var(--surface2)' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: ok ? 'var(--green)' : 'var(--muted)',
        animation: ok ? 'agblink 1.2s step-start infinite' : undefined }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: ok ? 'var(--green)' : 'var(--muted)' }}>
        {connected === null ? 'CONNECTING' : ok ? 'LIVE' : 'OFFLINE'}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{children}</div>;
}

const cardStyle: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
};
const heroStyle: CSSProperties = {
  ...cardStyle, padding: '24px 24px',
  background: 'linear-gradient(135deg, rgba(99,102,241,0.20), rgba(56,189,248,0.06) 60%, transparent)',
  borderColor: 'rgba(99,102,241,0.35)',
};

const KEYFRAMES = `
@keyframes agpulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes agblink { 0%,60% { opacity: 1; } 61%,100% { opacity: 0.25; } }
@keyframes agflow  { to { stroke-dashoffset: -10; } }
`;
