import { useEffect, useState, type CSSProperties } from 'react';
import { api, type RobotHealth, type RobotComponent, type RobotTestResult } from '../api/client';
import armImg from '../assets/arm.jpg';
import baseImg from '../assets/base.jpg';

const COMPONENTS: { key: 'robot' | 'base' | 'camera'; icon: string; img?: string; title: string; api: string }[] = [
  { key: 'robot',  icon: '🦾', img: armImg,  title: 'Robot Arm',      api: 'GET /arm/state' },
  { key: 'base',   icon: '🚗', img: baseImg, title: 'AGV Base',       api: 'GET /base/state' },
  { key: 'camera', icon: '📷',               title: 'Camera Capture', api: 'POST /capture' },
];

// Which extra fields to surface per component, in order
const EXTRA_FIELDS: Record<string, [string, string][]> = {
  robot:  [['arm_state', 'Arm state']],
  base:   [['base_state', 'Base state']],
  camera: [['width', 'Width'], ['height', 'Height'], ['scale_x', 'Scale X'], ['scale_y', 'Scale Y']],
};

function statusColor(s: string) {
  if (s === 'ok') return 'var(--green)';
  if (s === 'error') return 'var(--red)';
  return 'var(--muted)';
}
function statusLabel(s: string) {
  if (s === 'ok') return 'Healthy';
  if (s === 'error') return 'Error';
  return 'Unknown';
}

function Dot({ status, size = 10 }: { status: string; size?: number }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: statusColor(status), boxShadow: `0 0 0 3px color-mix(in srgb, ${statusColor(status)} 22%, transparent)`,
      flexShrink: 0,
    }} />
  );
}

function ComponentCard({ meta, comp }: {
  meta: { key: string; icon: string; img?: string; title: string; api: string };
  comp: RobotComponent | undefined;
}) {
  const status = comp?.status ?? 'unknown';
  const isErr  = status === 'error';
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${isErr ? 'var(--red)' : 'var(--border)'}`,
      borderRadius: 10, padding: 16, flex: 1, minWidth: 220,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {meta.img
          ? <img src={meta.img} alt={meta.title}
              style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 7, background: '#fff', padding: 2, flexShrink: 0 }} />
          : <span style={{ fontSize: 20 }}>{meta.icon}</span>}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{meta.title}</div>
          <code style={{ fontSize: 10.5, color: 'var(--muted)' }}>{meta.api}</code>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: statusColor(status) }}>
          <Dot status={status} /> {statusLabel(status)}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: isErr ? 'var(--red)' : 'var(--muted)', lineHeight: 1.5, minHeight: 34 }}>
        {comp?.detail ?? 'No data'}
      </div>

      {comp && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {(EXTRA_FIELDS[meta.key] ?? []).map(([field, label]) => {
            const v = comp[field];
            if (v === undefined || v === null || v === '') return null;
            return (
              <span key={field} style={{
                fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '3px 8px', color: 'var(--text)',
              }}>
                <span style={{ color: 'var(--muted)' }}>{label}: </span>{String(v)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RobotSetup() {
  const [health,  setHealth]  = useState<RobotHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = async (capture: boolean) => {
    setLoading(true); setError('');
    try {
      setHealth(await api.getRobotHealth(capture));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(true); }, []);

  const healthy   = health?.healthy ?? false;
  const simulated = health?.simulated ?? false;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: 'var(--text)' }}>Robot Setup</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            Confirm the robot, kiosk, and camera are ready <strong>before running real-robot tests</strong>.
            Each check calls the Robot API directly.
          </p>
        </div>
        <button onClick={() => load(false)} disabled={loading}
          style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: loading ? 'wait' : 'pointer', fontSize: 12.5 }}>
          ↻ Re-check
        </button>
        <button onClick={() => load(true)} disabled={loading}
          style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: loading ? 'wait' : 'pointer', fontSize: 12.5 }}>
          📷 Capture + Calibrate
        </button>
      </div>

      {/* overall banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, marginBottom: 16,
        background: healthy ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'color-mix(in srgb, var(--red) 12%, transparent)',
        border: `1px solid ${healthy ? 'var(--green)' : 'var(--red)'}`,
      }}>
        <Dot status={healthy ? 'ok' : 'error'} size={14} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: healthy ? 'var(--green)' : 'var(--red)', fontSize: 14 }}>
            {loading ? 'Checking…' : healthy ? 'Robot setup is healthy — ready to test' : 'Robot setup is NOT ready'}
          </div>
          {simulated && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Simulated status — backend is <code>{health?.backend}</code>, not a physical robot.
            </div>
          )}
        </div>
      </div>

      {/* connection info incl. Robot URL */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', fontSize: 13 }}>
          <div><span style={{ color: '#0ea5e9', fontWeight: 600 }}>AGV URL: </span>
            <code style={{ color: 'var(--text)' }}>{health?.agv_url ?? health?.robot_url ?? '—'}</code></div>
          <div><span style={{ color: '#f59e0b', fontWeight: 600 }}>Arm URL: </span>
            <code style={{ color: 'var(--text)' }}>{health?.arm_url ?? health?.robot_url ?? '—'}</code></div>
          <div><span style={{ color: 'var(--muted)' }}>Backend: </span>
            <code style={{ color: 'var(--text)' }}>{health?.backend ?? '—'}</code></div>
          <div><span style={{ color: 'var(--muted)' }}>Robot ID: </span>
            <code style={{ color: 'var(--text)' }}>{health?.robot_id ?? '—'}</code></div>
          <div><span style={{ color: 'var(--muted)' }}>Kiosk ID: </span>
            <code style={{ color: 'var(--text)' }}>{health?.kiosk_id ?? '—'}</code></div>
        </div>
      </div>

      {/* transport / fatal error */}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 13 }}>
          ✗ Could not reach the management API: {error}
        </div>
      )}
      {health?.error && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 13 }}>
          ✗ {health.error}
        </div>
      )}

      {/* component cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {COMPONENTS.map(meta => (
          <ComponentCard key={meta.key} meta={meta} comp={health?.components?.[meta.key]} />
        ))}
      </div>

      {/* camera / coordinate calibration */}
      <CameraCalibration health={health} />

      {/* Robot API tester */}
      <ApiTester
        agvUrl={health?.agv_url ?? health?.robot_url}
        armUrl={health?.arm_url ?? health?.robot_url}
        backend={health?.backend}
      />
    </div>
  );
}

// ── Camera & coordinate calibration ───────────────────────────────────────────────
// The ONE thing an operator sets so the arm taps accurately: the exploration viewport must have the
// SAME ASPECT RATIO as the robot's rectified camera frame. app_map coords are learned in the
// Playwright exploration viewport; at test time real_robot._scale maps them to the camera's rectified
// pixels PER-AXIS. That's exact when the two share an aspect ratio — otherwise a responsive app
// reflows and taps drift. The camera resolution itself is auto-measured from every /capture (shown in
// the Camera Capture card above and used by calibration), so "camera" here is only a pre-calibration
// seed. "Match to measured camera" copies the measured rectified resolution into the viewport (→ 1:1,
// no aspect risk). Camera-model-agnostic: a new camera just reports different dims; nothing to code.

function aspectStr(w: number, h: number): string {
  if (!w || !h) return '—';
  const r = w / h;
  const known: [number, string][] = [[16 / 9, '16:9'], [4 / 3, '4:3'], [14 / 9, '14:9'], [3 / 2, '3:2'], [16 / 10, '16:10']];
  for (const [val, label] of known) if (Math.abs(r - val) < 0.02) return `${label}`;
  return r.toFixed(3);
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</label>
      <input type="number" value={value} min={1}
        onChange={e => onChange(Math.max(0, Number(e.target.value)))}
        style={{ width: 96, fontSize: 12.5, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
    </div>
  );
}

function CameraCalibration({ health }: { health: RobotHealth | null }) {
  const [vw, setVw] = useState(1400);
  const [vh, setVh] = useState(900);
  const [cw, setCw] = useState(1280);
  const [ch, setCh] = useState(720);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setVw(cfg.viewport.width); setVh(cfg.viewport.height);
        setCw(cfg.camera.width);   setCh(cfg.camera.height);
      } catch { /* keep defaults */ } finally { setLoaded(true); }
    })();
  }, []);

  const measuredW = Number(health?.components?.camera?.width) || 0;
  const measuredH = Number(health?.components?.camera?.height) || 0;
  const aspectMismatch = loaded && !!vh && !!ch && Math.abs(vw / vh - cw / ch) > 0.02;

  const save = async (body: { viewport_width?: number; viewport_height?: number; camera_width?: number; camera_height?: number }) => {
    setSaving(true); setMsg(null);
    try {
      const r = await api.setCameraConfig(body);
      setMsg({ ok: true, text: `Saved · exploration ${r.viewport.width}×${r.viewport.height} (${aspectStr(r.viewport.width, r.viewport.height)}) · camera seed ${r.camera.width}×${r.camera.height} (${aspectStr(r.camera.width, r.camera.height)}) · ${r.aspect_matches ? 'aspect matches ✓' : 'aspect differs ⚠ — taps may drift on a responsive app'}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setSaving(false); }
  };

  const btn = (bg: string): CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, border: 'none', background: bg, color: '#fff',
    fontSize: 12.5, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
  });

  return (
    <div style={{ marginTop: 26, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, color: 'var(--text)' }}>Camera &amp; Coordinate Calibration</h3>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>keeps arm taps accurate</span>
      </div>
      <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.55 }}>
        App exploration runs in Playwright at the <strong>exploration viewport</strong>; the robot photographs the
        kiosk and rectifies it to the <strong>camera</strong> resolution. Taps stay accurate when the two share an
        <strong> aspect ratio</strong> (the per-axis scale then absorbs any size difference). The camera resolution is
        auto-measured on every capture — the field below is only a pre-calibration seed. Set the exploration viewport to
        the camera’s aspect ratio (or click “Match to measured camera”) <strong>before exploring</strong>.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            Exploration viewport <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {aspectStr(vw, vh)}</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <NumField label="Width"  value={vw} onChange={setVw} />
            <NumField label="Height" value={vh} onChange={setVh} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            Camera seed <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {aspectStr(cw, ch)} · auto-measured on capture</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <NumField label="Width"  value={cw} onChange={setCw} />
            <NumField label="Height" value={ch} onChange={setCh} />
          </div>
        </div>
        {(measuredW > 0 && measuredH > 0) && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Measured (last capture) <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {aspectStr(measuredW, measuredH)}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', padding: '6px 0' }}>{measuredW} × {measuredH}</div>
          </div>
        )}
      </div>

      {aspectMismatch && (
        <div style={{ padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12.5,
          background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', border: '1px solid var(--yellow)', color: 'var(--text)' }}>
          ⚠ Exploration viewport ({aspectStr(vw, vh)}) and camera ({aspectStr(cw, ch)}) have different aspect ratios —
          re-explore at a matching aspect ratio, or the arm may tap slightly off on a responsive kiosk app.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button onClick={() => save({ viewport_width: vw, viewport_height: vh, camera_width: cw, camera_height: ch })}
          disabled={saving} style={btn('#6366f1')}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => { if (measuredW && measuredH) { setVw(measuredW); setVh(measuredH); save({ viewport_width: measuredW, viewport_height: measuredH }); } }}
          disabled={saving || !measuredW || !measuredH}
          title={measuredW ? '' : 'Run “Capture + Calibrate” first to measure the rectified resolution'}
          style={{ ...btn('#0ea5e9'), opacity: (saving || !measuredW) ? 0.5 : 1, cursor: (!measuredW || saving) ? 'not-allowed' : 'pointer' }}>
          Match viewport to measured camera
        </button>
        {msg && (
          <span style={{ fontSize: 12.5, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
            {msg.ok ? '✓ ' : '✗ '}{msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Robot API Tester ────────────────────────────────────────────────────────────
// Call each physical-robot endpoint in isolation to confirm it works before running
// real-robot tests. Ordered by the typical mission sequence (setup → move → capture →
// arm → click → card → recovery). Calls are proxied through the management API.

type Field =
  | { key: string; label: string; kind: 'text';   def: string;  help?: string }
  | { key: string; label: string; kind: 'number'; def: number;  help?: string }
  | { key: string; label: string; kind: 'bool';   def: boolean; help?: string }
  | { key: string; label: string; kind: 'select'; def: string;  options: string[]; help?: string }
  | { key: string; label: string; kind: 'json';   def: unknown; help?: string };

type Endpoint = {
  group: string; target: 'agv' | 'arm'; method: 'GET' | 'POST'; path: string;
  title: string; desc: string; fields: Field[];
};

// Endpoints are grouped by which controller they hit — the AGV base and the arm have separate
// IPs. "Common" (/setup) is applied to both controllers during a real run; the tester sends it
// to the arm controller (switch the AGV URL to test the base side of setup if needed).
const ROBOT_ENDPOINTS: Endpoint[] = [
  // ── Common (both controllers) ──
  { group: 'Common', target: 'arm', method: 'POST', path: '/setup', title: 'Configure robot',
    desc: 'Common to both controllers. Upload kiosk definitions, named arm poses, and the navigation map. During a real run this is applied to BOTH the AGV and arm controllers; the tester sends it to the arm URL.',
    fields: [
      { key: 'robot_id',  label: 'robot_id',      kind: 'text', def: 'R-01' },
      { key: 'kiosks',    label: 'kiosks',        kind: 'json',
        def: [{ kiosk_id: 'K-07', x: 3.2, y: 1.5, theta: 1.57, screen_w_m: 0.4, screen_h_m: 0.3, tag_id: 12 }] },
      { key: 'arm_poses', label: 'arm_poses',     kind: 'json',
        def: { inspect_screen: [0, -45, 30, 0, 60, 0], card_reader_approach: [10, -30, 45, 0, 50, 0] } },
      { key: 'map',       label: 'map (base64)',  kind: 'text', def: '<base64 encoded map data>' },
    ] },

  // ── AGV base APIs (AGV URL) ──
  { group: 'AGV', target: 'agv', method: 'POST', path: '/base/goto', title: 'Move base to target',
    desc: 'Navigate the AGV base (on which the arm sits) to a kiosk or home. Non-blocking — poll /base/state.',
    fields: [
      { key: 'cmd_id', label: 'cmd_id', kind: 'text', def: 'c-001' },
      { key: 'target', label: 'target', kind: 'text', def: 'K-07', help: "kiosk id (e.g. K-07) or 'home'" },
    ] },
  { group: 'AGV', target: 'agv', method: 'POST', path: '/base/abort', title: 'Abort base',
    desc: 'Immediately stop base motion.',
    fields: [{ key: 'cmd_id', label: 'cmd_id', kind: 'text', def: 'c-002' }] },
  { group: 'AGV', target: 'agv', method: 'GET', path: '/base/state', title: 'Base state',
    desc: 'Current base state, last cmd_id, robot_id. Poll until idle. Values: idle | moving | error.', fields: [] },
  { group: 'AGV', target: 'agv', method: 'GET', path: '/base/pose', title: 'Base pose',
    desc: 'Current 2D pose of the AGV base in the map frame: {x, y, theta}.', fields: [] },

  // ── Arm APIs (Arm URL) ──
  { group: 'Arm', target: 'arm', method: 'POST', path: '/capture', title: 'Capture screen',
    desc: 'Blocking — returns the image directly. type=screen runs the full perception pipeline (tag detect + rectify) and establishes the screen pose used by click/card; type=raw returns the raw camera frame.',
    fields: [
      { key: 'cmd_id', label: 'cmd_id', kind: 'text',   def: 'c-010' },
      { key: 'type',   label: 'type',   kind: 'select', def: 'screen', options: ['screen', 'raw'] },
    ] },
  { group: 'Arm', target: 'arm', method: 'POST', path: '/screen/click', title: 'Click screen point(s)',
    desc: 'Tap one or more (u,v) points on the last rectified capture. Requires a successful screen capture since the last base move. Non-blocking — poll /arm/state for click_result.',
    fields: [
      { key: 'cmd_id',             label: 'cmd_id',             kind: 'text',   def: 'c-020' },
      { key: 'points',             label: 'points [{u,v}]',     kind: 'json',   def: [{ u: 542, v: 318 }] },
      { key: 'capture_after_last', label: 'capture_after_last', kind: 'bool',   def: true },
      { key: 'delay_between_ms',   label: 'delay_between_ms',   kind: 'number', def: 500 },
    ] },
  { group: 'Arm', target: 'arm', method: 'POST', path: '/arm/command', title: 'Move arm to pose',
    desc: 'Move the arm to a named pose from /setup (home always available). Non-blocking — poll /arm/state.',
    fields: [
      { key: 'cmd_id',    label: 'cmd_id',    kind: 'text',   def: 'c-030' },
      { key: 'action',    label: 'action',    kind: 'select', def: 'goto_pose', options: ['goto_pose', 'home'] },
      { key: 'pose_name', label: 'pose_name', kind: 'text',   def: 'inspect_screen', help: 'required when action = goto_pose' },
    ] },
  { group: 'Arm', target: 'arm', method: 'POST', path: '/arm/abort', title: 'Abort arm',
    desc: 'Immediately stop arm motion. Use with /arm/command {action:"home"} to recover from an error state.',
    fields: [{ key: 'cmd_id', label: 'cmd_id', kind: 'text', def: 'c-031' }] },
  { group: 'Arm', target: 'arm', method: 'GET', path: '/arm/state', title: 'Arm state',
    desc: 'Current arm state + last cmd_id. Carries click_result / card_image after those ops. Values: idle | moving | holding_card | error.', fields: [] },
  { group: 'Arm', target: 'arm', method: 'POST', path: '/card/pick', title: 'Pick card',
    desc: 'Pick the credit card from its holder on the robot. Arm then holds the card (state holding_card); /arm/state includes card_image.',
    fields: [{ key: 'cmd_id', label: 'cmd_id', kind: 'text', def: 'c-040' }] },
  { group: 'Arm', target: 'arm', method: 'POST', path: '/card/tap', title: 'Tap card on reader',
    desc: "Tap the held card on the kiosk's card reader. Requires a held card and a prior screen localization.",
    fields: [{ key: 'cmd_id', label: 'cmd_id', kind: 'text', def: 'c-041' }] },
  { group: 'Arm', target: 'arm', method: 'POST', path: '/card/replace', title: 'Replace card',
    desc: 'Return the held card to its holder on the robot. Clears the held-card image.',
    fields: [{ key: 'cmd_id', label: 'cmd_id', kind: 'text', def: 'c-042' }] },
];

const GROUP_COLOR: Record<string, string> = {
  'Common': '#6366f1', 'AGV': '#0ea5e9', 'Arm': '#f59e0b',
};

/** Replace long image_b64 strings with a short placeholder for the text view. */
function truncateB64(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(truncateB64);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = (k === 'image_b64' && typeof v === 'string' && v.length > 48)
        ? `‹base64 ${v.length} chars›` : truncateB64(v);
    }
    return out;
  }
  return obj;
}

/** Find the first image_b64 anywhere in the response (top-level, click_result, card_image). */
function findImage(obj: unknown): { b64: string; format?: string } | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.image_b64 === 'string' && rec.image_b64.length > 48)
    return { b64: rec.image_b64, format: typeof rec.format === 'string' ? rec.format : undefined };
  for (const v of Object.values(rec)) { const f = findImage(v); if (f) return f; }
  return null;
}

function TesterRow({ ep }: { ep: Endpoint }) {
  const [open, setOpen]       = useState(false);
  const [vals, setVals]       = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of ep.fields) v[f.key] = f.kind === 'json' ? JSON.stringify(f.def, null, 2) : f.def;
    return v;
  });
  const [resp, setResp]       = useState<RobotTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [bodyErr, setBodyErr] = useState('');

  const color = GROUP_COLOR[ep.group] ?? 'var(--muted)';

  const buildBody = (): Record<string, unknown> | null => {
    const body: Record<string, unknown> = {};
    for (const f of ep.fields) {
      const raw = vals[f.key];
      if (f.kind === 'json') {
        try { body[f.key] = JSON.parse(String(raw)); }
        catch { setBodyErr(`${f.label}: invalid JSON`); return null; }
      } else if (f.kind === 'number') {
        body[f.key] = typeof raw === 'number' ? raw : Number(raw);
      } else {
        body[f.key] = raw;
      }
    }
    setBodyErr('');
    return body;
  };

  const send = async () => {
    let body: Record<string, unknown> | undefined;
    if (ep.method === 'POST') {
      const b = buildBody();
      if (b === null) return;
      body = b;
    }
    setLoading(true); setResp(null);
    try {
      setResp(await api.robotTestCall({ method: ep.method, path: ep.path, body, target: ep.target }));
    } catch (e) {
      setResp({ ok: false, method: ep.method, url: '', elapsed_ms: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  const img = resp && !resp.error ? findImage(resp.response_body) : null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden', background: 'var(--surface)' }}>
      {/* header row */}
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                 background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 78 }}>{ep.group}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, minWidth: 40, textAlign: 'center',
                       background: ep.method === 'GET' ? 'rgba(14,165,233,0.15)' : 'rgba(16,185,129,0.15)',
                       color: ep.method === 'GET' ? '#0ea5e9' : '#10b981' }}>{ep.method}</span>
        <code style={{ fontSize: 12.5, color: 'var(--text)' }}>{ep.path}</code>
        <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>{ep.title}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '10px 0' }}>{ep.desc}</p>

          {/* request body fields */}
          {ep.fields.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {ep.fields.map(f => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
                    <code style={{ color: 'var(--text)' }}>{f.label}</code>
                    {f.help && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>{f.help}</span>}
                  </label>
                  {f.kind === 'json' ? (
                    <textarea value={String(vals[f.key])} spellCheck={false}
                      onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                      style={{ width: '100%', minHeight: 68, fontFamily: 'monospace', fontSize: 12, padding: 8,
                               borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
                  ) : f.kind === 'select' ? (
                    <select value={String(vals[f.key])}
                      onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                      style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.kind === 'bool' ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text)' }}>
                      <input type="checkbox" checked={Boolean(vals[f.key])}
                        onChange={e => setVals(v => ({ ...v, [f.key]: e.target.checked }))} />
                      {String(Boolean(vals[f.key]))}
                    </label>
                  ) : (
                    <input type={f.kind === 'number' ? 'number' : 'text'} value={String(vals[f.key])}
                      onChange={e => setVals(v => ({ ...v, [f.key]: f.kind === 'number' ? Number(e.target.value) : e.target.value }))}
                      style={{ width: '100%', fontSize: 12.5, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
                  )}
                </div>
              ))}
            </div>
          )}
          {ep.fields.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 12 }}>No request body.</p>
          )}

          {bodyErr && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>✗ {bodyErr}</div>}

          <button onClick={send} disabled={loading}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: color, color: '#fff',
                     fontSize: 12.5, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Sending…' : `Send ${ep.method}`}
          </button>

          {/* response */}
          {resp && (
            <div style={{ marginTop: 12 }}>
              {resp.error ? (
                <div style={{ fontSize: 12.5, color: 'var(--red)' }}>✗ {resp.error}</div>
              ) : (
                <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: resp.ok ? 'var(--green)' : 'var(--red)' }}>
                    {resp.ok ? '✓' : '✗'} HTTP {resp.status_code}
                  </span>
                  <span style={{ color: 'var(--muted)' }}> · {resp.elapsed_ms} ms</span>
                </div>
              )}
              {img && (
                <img alt="response frame" src={`data:image/${img.format || 'jpeg'};base64,${img.b64}`}
                  style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 6, border: '1px solid var(--border)', marginBottom: 8, display: 'block' }} />
              )}
              {resp.response_body !== undefined && (
                <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', fontSize: 11.5, lineHeight: 1.5, padding: 10,
                              borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                  {JSON.stringify(truncateB64(resp.response_body), null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TESTER_SECTIONS: { group: string; target: 'agv' | 'arm'; title: string; note: string }[] = [
  { group: 'Common', target: 'arm', title: 'Common', note: 'applied to both controllers' },
  { group: 'AGV',    target: 'agv', title: 'AGV base APIs', note: 'sent to the AGV URL' },
  { group: 'Arm',    target: 'arm', title: 'Arm APIs', note: 'sent to the Arm URL' },
];

function ApiTester({ agvUrl, armUrl, backend }: { agvUrl?: string; armUrl?: string; backend?: string }) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, color: 'var(--text)' }}>Robot API Tester</h3>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>call each endpoint in isolation</span>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
        The AGV base and the arm are on separate controllers. AGV endpoints go to{' '}
        <code style={{ color: '#0ea5e9' }}>{agvUrl ?? '—'}</code> and arm endpoints go to{' '}
        <code style={{ color: '#f59e0b' }}>{armUrl ?? '—'}</code>. Expand a row to edit the body and send.
        Non-blocking commands (base/arm/screen/card) return a <code>202</code> ack — poll the matching{' '}
        <code>state</code> row to see completion.
      </p>
      {backend && backend !== 'real' && (
        <div style={{ padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12.5,
                      background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', border: '1px solid var(--yellow)', color: 'var(--text)' }}>
          Backend is <code>{backend}</code>, not <code>real</code> — calls target the configured AGV / Arm URLs and will
          fail unless a physical robot is reachable there.
        </div>
      )}
      {TESTER_SECTIONS.map(sec => {
        const eps = ROBOT_ENDPOINTS.filter(e => e.group === sec.group);
        const url = sec.target === 'agv' ? agvUrl : armUrl;
        const color = GROUP_COLOR[sec.group] ?? 'var(--muted)';
        return (
          <div key={sec.group} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 8px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>{sec.title}</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {sec.note} · <code style={{ color: 'var(--text)' }}>{url ?? '—'}</code>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {eps.map(ep => <TesterRow key={`${ep.method} ${ep.path}`} ep={ep} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
