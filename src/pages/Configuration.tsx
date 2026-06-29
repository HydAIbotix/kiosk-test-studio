import { useEffect, useState } from 'react';
import { api, type Config, type KioskConfig, type DeviceConfig } from '../api/client';

const BLANK_KIOSK: KioskConfig = {
  kiosk_id: '', name: '', url: 'http://localhost:5173', robot_id: 'R-01',
  screen_w_m: 0.4, screen_h_m: 0.3, tag_id: 1,
};

const BLANK_DEVICE: DeviceConfig = { alias: '', description: '', pos_x: 0, pos_y: 0, pos_theta: 0 };

// Stable palette for device aliases (cycles if >8 devices)
const DEVICE_COLORS = ['#6366f1','#f59e0b','#22c55e','#3b82f6','#ec4899','#a855f7','#14b8a6','#f97316'];
function deviceColor(alias: string, allAliases: string[]) {
  const idx = allAliases.indexOf(alias);
  return DEVICE_COLORS[idx % DEVICE_COLORS.length] ?? 'var(--muted)';
}

export default function Configuration() {
  const [config,   setConfig]  = useState<Config | null>(null);
  const [kiosk,    setKiosk]   = useState<KioskConfig>(BLANK_KIOSK);
  const [device,   setDevice]  = useState<DeviceConfig>(BLANK_DEVICE);
  const [saving,   setSaving]  = useState(false);
  const [saveMsg,  setSaveMsg] = useState('');
  const [devSaving,setDevSav]  = useState(false);
  const [devMsg,   setDevMsg]  = useState('');
  const [loading,  setLoading] = useState(true);

  const reload = () => api.getConfig().then(c => { setConfig(c); if (c.kiosks.length > 0) setKiosk(c.kiosks[0]); });

  useEffect(() => { reload().finally(() => setLoading(false)); }, []);

  const saveKiosk = async () => {
    setSaving(true); setSaveMsg('');
    try { await api.upsertKiosk(kiosk); setSaveMsg('✓ Saved'); reload(); }
    catch (e) { setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  const saveDevice = async () => {
    if (!device.alias.trim()) { setDevMsg('Alias is required'); return; }
    setDevSav(true); setDevMsg('');
    try { await api.upsertDevice(device); setDevMsg('✓ Saved'); setDevice(BLANK_DEVICE); reload(); }
    catch (e) { setDevMsg(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setDevSav(false); }
  };

  const removeDevice = async (alias: string) => {
    if (!confirm(`Remove device "${alias}"? Plans that reference it will need to be regenerated.`)) return;
    await api.deleteDevice(alias);
    reload();
  };

  if (loading) return <p className="text-muted">Loading configuration…</p>;

  const allAliases = (config?.devices ?? []).map(d => d.alias);

  return (
    <div>
      {/* System info (read-only) */}
      <div className="card section">
        <div className="section-title">System Configuration (from .env)</div>
        <div className="grid-4" style={{ marginTop: 8 }}>
          <InfoTile label="Robot Backend" value={config?.robot_backend ?? '—'} />
          <InfoTile label="Robot IP"      value={config?.robot_ip ?? '—'} />
          <InfoTile label="Robot ID"      value={config?.robot_id ?? '—'} />
          <InfoTile label="Viewport"      value={`${config?.viewport.width}×${config?.viewport.height}`} />
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
          To change robot_backend, robot_ip, etc. edit .env and restart the server.
        </p>
      </div>

      {/* ── Device Map ─────────────────────────────────────────────────────── */}
      <div className="card section">
        <div className="section-title">Device Map</div>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
          One-time setup. Add every physical device the robot must visit during tests — use the
          abbreviations your team already writes in test steps (<strong>TVM</strong>,&nbsp;
          <strong>MPOS</strong>, <strong>RSV</strong>, <strong>BMV</strong>, etc.).
          Claude reads this map when generating plans and tags each step with the target device.
          The robot moves to the device's position before interacting with its touchscreen.
        </p>

        {/* Existing device table */}
        {allAliases.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Alias</th><th>Description</th><th>X (m)</th><th>Y (m)</th><th>θ (°)</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(config!.devices).map(d => (
                  <tr key={d.alias} style={{ cursor: 'pointer' }} onClick={() => setDevice({ ...d })}>
                    <td>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: deviceColor(d.alias, allAliases), marginRight: 7 }} />
                      <strong style={{ fontFamily: 'monospace', fontSize: 12, color: deviceColor(d.alias, allAliases) }}>{d.alias}</strong>
                    </td>
                    <td style={{ fontSize: 12 }}>{d.description}</td>
                    <td className="monospace" style={{ fontSize: 12 }}>{d.pos_x.toFixed(2)}</td>
                    <td className="monospace" style={{ fontSize: 12 }}>{d.pos_y.toFixed(2)}</td>
                    <td className="monospace" style={{ fontSize: 12 }}>{d.pos_theta.toFixed(1)}</td>
                    <td>
                      <button style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                        onClick={e => { e.stopPropagation(); removeDevice(d.alias); }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add / edit device form */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--text)' }}>
            {device.alias && allAliases.includes(device.alias) ? `Edit — ${device.alias}` : 'Add Device'}
          </div>
          <div className="grid-2" style={{ gap: 10, marginBottom: 10 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Alias <span style={{ color: 'var(--red)' }}>*</span></label>
              <input className="form-input" value={device.alias}
                onChange={e => setDevice(d => ({ ...d, alias: e.target.value.toUpperCase() }))}
                placeholder="TVM" style={{ fontFamily: 'monospace', textTransform: 'uppercase' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Full Name / Description</label>
              <input className="form-input" value={device.description}
                onChange={e => setDevice(d => ({ ...d, description: e.target.value }))}
                placeholder="Ticket Vending Machine" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">X position (m)</label>
              <input className="form-input" type="number" step="0.01" value={device.pos_x}
                onChange={e => setDevice(d => ({ ...d, pos_x: Number(e.target.value) }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Y position (m)</label>
              <input className="form-input" type="number" step="0.01" value={device.pos_y}
                onChange={e => setDevice(d => ({ ...d, pos_y: Number(e.target.value) }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Heading θ (°)</label>
              <input className="form-input" type="number" step="1" value={device.pos_theta}
                onChange={e => setDevice(d => ({ ...d, pos_theta: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={saveDevice} disabled={devSaving || !device.alias.trim()}>
              {devSaving ? '⏳ Saving…' : '💾 Save Device'}
            </button>
            {device.alias && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setDevice(BLANK_DEVICE); setDevMsg(''); }}>Clear</button>
            )}
            {devMsg && <span style={{ fontSize: 12, color: devMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{devMsg}</span>}
          </div>
        </div>

        {allAliases.length === 0 && (
          <div className="card card-sm" style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)', marginTop: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--yellow)' }}>
              ⚠ No devices configured yet. Plans generated without a device map still work —
              Claude infers device names from test step text — but adding entries here lets the
              robot navigate to exact physical positions and makes the Execution preview richer.
            </p>
          </div>
        )}
      </div>

      <div className="grid-2">
        {/* Kiosk editor */}
        <div className="card section">
          <div className="section-title">Kiosk Configuration</div>
          {config && config.kiosks.length > 1 && (
            <div className="form-group">
              <label className="form-label">Edit Kiosk</label>
              <select className="form-select" value={kiosk.kiosk_id} onChange={e => setKiosk(config.kiosks.find(k => k.kiosk_id === e.target.value) ?? BLANK_KIOSK)}>
                {config.kiosks.map(k => <option key={k.kiosk_id} value={k.kiosk_id}>{k.kiosk_id} — {k.name}</option>)}
                <option value="">+ New Kiosk</option>
              </select>
            </div>
          )}
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Kiosk ID</label>
              <input className="form-input" value={kiosk.kiosk_id} onChange={e => setKiosk(k => ({...k, kiosk_id: e.target.value}))} placeholder="K-01" />
            </div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={kiosk.name} onChange={e => setKiosk(k => ({...k, name: e.target.value}))} placeholder="Card Station" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Kiosk URL</label>
            <input className="form-input" value={kiosk.url} onChange={e => setKiosk(k => ({...k, url: e.target.value}))} placeholder="http://localhost:5173" />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Assigned Robot</label>
              <input className="form-input" value={kiosk.robot_id} onChange={e => setKiosk(k => ({...k, robot_id: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">AprilTag ID</label>
              <input className="form-input" type="number" value={kiosk.tag_id} onChange={e => setKiosk(k => ({...k, tag_id: Number(e.target.value)}))} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Screen Width (m)</label>
              <input className="form-input" type="number" step="0.01" value={kiosk.screen_w_m} onChange={e => setKiosk(k => ({...k, screen_w_m: Number(e.target.value)}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Screen Height (m)</label>
              <input className="form-input" type="number" step="0.01" value={kiosk.screen_h_m} onChange={e => setKiosk(k => ({...k, screen_h_m: Number(e.target.value)}))} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveKiosk} disabled={saving || !kiosk.kiosk_id}>
            {saving ? '⏳ Saving…' : '💾 Save Kiosk Config'}
          </button>
          {saveMsg && <span style={{ marginLeft: 10, fontSize: 12, color: saveMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{saveMsg}</span>}
        </div>

        {/* Credentials / Card config */}
        <div className="card section">
          <div className="section-title">Global Test Credentials</div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 14 }}>
            Stored in your browser (localStorage). Used as defaults when test cases require login.
            Per-test-case overrides can be set in <strong style={{ color: 'var(--accent2)' }}>Test Intake → Required Inputs</strong>.
          </p>
          <GlobalCreds />
          <hr className="divider" />
          <div className="section-title">Smart Card Config</div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
            The robot taps a card on the NFC reader. Card numbers and balances are tracked in the kiosk shared localStorage ledger.
          </p>
          <CredRow label="Card station" value="KIOSK-ID-1" />
          <CredRow label="POS kiosk"    value="KIOSK-ID-2" />
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
            ⚠ If a card number or balance is missing before an E2E test, the runner will warn before starting.
          </p>
        </div>
      </div>

      {/* Kiosk list */}
      {config && config.kiosks.length > 0 && (
        <div className="card">
          <div className="section-title">Configured Kiosks</div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Kiosk ID</th><th>Name</th><th>URL</th><th>Robot</th><th>Tag</th><th>Screen (m)</th></tr></thead>
              <tbody>
                {config.kiosks.map(k => (
                  <tr key={k.kiosk_id} style={{ cursor: 'pointer' }} onClick={() => setKiosk(k)}>
                    <td className="monospace">{k.kiosk_id}</td>
                    <td>{k.name}</td>
                    <td className="monospace" style={{ fontSize: 11 }}>{k.url}</td>
                    <td>{k.robot_id}</td>
                    <td>{k.tag_id}</td>
                    <td>{k.screen_w_m}×{k.screen_h_m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric" style={{ padding: '10px 12px' }}>
      <div className="metric-label">{label}</div>
      <div style={{ fontFamily: 'monospace', marginTop: 4, fontSize: 14 }}>{value}</div>
    </div>
  );
}

const GLOBAL_CREDS_KEY = 'global_test_creds';
const GLOBAL_FIELDS = [
  { key: 'email',       label: 'Login Email',         placeholder: 'tester@kiosk.local',    type: 'text' },
  { key: 'password',    label: 'Password',             placeholder: 'Password123',            type: 'password' },
  { key: 'card_number', label: 'Smart Card #',         placeholder: 'e.g. 4111111111111111', type: 'text' },
  { key: 'amount',      label: 'Card Load Amount ($)', placeholder: '50.00',                  type: 'number' },
];

function GlobalCreds() {
  const [creds, setCreds] = useState<Record<string, string>>(() =>
    JSON.parse(localStorage.getItem(GLOBAL_CREDS_KEY) || '{}')
  );
  const [saved, setSaved] = useState(false);

  const set = (k: string, v: string) => setCreds(c => ({ ...c, [k]: v }));
  const save = () => {
    localStorage.setItem(GLOBAL_CREDS_KEY, JSON.stringify(creds));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const filled    = GLOBAL_FIELDS.filter(f => creds[f.key]?.trim()).length;
  const allFilled = filled === GLOBAL_FIELDS.length;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {GLOBAL_FIELDS.map(f => (
          <div key={f.key}>
            <label className="form-label">{f.label}</label>
            <input className="form-input" type={f.type === 'password' ? 'password' : 'text'}
              inputMode={f.type === 'number' ? 'decimal' : 'text'}
              value={creds[f.key] || ''} placeholder={f.placeholder}
              onChange={e => set(f.key, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={save}>Save Credentials</button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Saved</span>}
        <span className="spacer" />
        <span style={{ fontSize: 12, color: allFilled ? 'var(--green)' : 'var(--muted)' }}>
          {filled} / {GLOBAL_FIELDS.length} fields set
        </span>
      </div>
      {!allFilled && (
        <div className="card card-sm" style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)', marginTop: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--yellow)' }}>
            ⚠ Some credentials are missing. Test cases that require these values cannot run until they are provided.
            You can also set per-test overrides in <strong>Test Intake</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

function CredRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="form-group" style={{ marginBottom: 8 }}>
      <div className="row">
        <span className="form-label" style={{ marginBottom: 0, width: 160, flexShrink: 0 }}>{label}</span>
        <code style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12, color: 'var(--text)' }}>{value}</code>
      </div>
    </div>
  );
}
