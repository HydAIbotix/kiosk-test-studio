import { useEffect, useState } from 'react';
import { api, type Config, type KioskConfig, type DeviceConfig, type ExploreConfig } from '../api/client';

const BLANK_KIOSK: KioskConfig = {
  kiosk_id: '', name: '', url: 'http://localhost:5173', robot_id: 'R-01',
  screen_w_m: 0.4, screen_h_m: 0.3, tag_id: 1,
};

const BLANK_DEVICE: DeviceConfig = { alias: '', kiosk_id: '', description: '', pos_x: 0, pos_y: 0, pos_theta: 0 };

// Stable palette for device aliases (cycles if >8 devices)
const DEVICE_COLORS = ['#6366f1','#f59e0b','#22c55e','#3b82f6','#ec4899','#a855f7','#14b8a6','#f97316'];
function deviceColor(alias: string, allAliases: string[]) {
  const idx = allAliases.indexOf(alias);
  return DEVICE_COLORS[idx % DEVICE_COLORS.length] ?? 'var(--muted)';
}

export default function Configuration({ onNav }: { onNav?: (p: string) => void }) {
  const [config,       setConfig]     = useState<Config | null>(null);
  const [kiosk,        setKiosk]      = useState<KioskConfig>(BLANK_KIOSK);
  const [device,       setDevice]     = useState<DeviceConfig>(BLANK_DEVICE);
  const [saving,       setSaving]     = useState(false);
  const [saveMsg,      setSaveMsg]    = useState('');
  const [devSaving,    setDevSav]     = useState(false);
  const [devMsg,       setDevMsg]     = useState('');
  const [loading,      setLoading]    = useState(true);
  const [exploreConf,  setExploreCon] = useState<ExploreConfig | null>(null);
  const [exploreMode,  setExplMode]   = useState<string>('claude');
  const [exploreSaving,setExpSaving]  = useState(false);
  const [exploreMsg,   setExploreMsg] = useState('');
  const [robotForm,    setRobotForm]  = useState({ robot_backend: 'demo', robot_ip: '', robot_port: 8000, agv_url: '', arm_url: '' });
  const [robotSaving,  setRobotSaving]= useState(false);
  const [robotMsg,     setRobotMsg]   = useState('');
  const [robotRestart, setRobotRestart]= useState(false);
  const [cardSvc,      setCardSvc]    = useState('');
  const [cardSvcSaving,setCardSvcSav] = useState(false);
  const [cardSvcMsg,   setCardSvcMsg] = useState('');

  const reload = () => api.getConfig().then(c => {
    setConfig(c);
    setRobotForm({ robot_backend: c.robot_backend, robot_ip: c.robot_ip, robot_port: c.robot_port, agv_url: c.agv_url || '', arm_url: c.arm_url || '' });
    setCardSvc(c.card_service_url || '');
    if (c.kiosks.length > 0) setKiosk(c.kiosks[0]);
  });

  const saveCardService = async () => {
    setCardSvcSav(true); setCardSvcMsg('');
    try {
      await api.setCardService(cardSvc.trim());
      setCardSvcMsg(cardSvc.trim() ? '✓ Saved — shared across kiosks' : '✓ Cleared — kiosks use local storage');
      reload();
    } catch (e) {
      setCardSvcMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCardSvcSav(false);
    }
  };
  const reloadExploreConf = () => api.getExploreConfig().then(c => { setExploreCon(c); setExplMode(c.mode); });

  useEffect(() => {
    Promise.all([reload(), reloadExploreConf()]).finally(() => setLoading(false));
  }, []);

  const saveRobot = async () => {
    setRobotSaving(true); setRobotMsg(''); setRobotRestart(false);
    try {
      const r = await api.setRobotConn({
        robot_backend: robotForm.robot_backend,
        robot_ip:      robotForm.robot_ip,
        robot_port:    robotForm.robot_port,
        agv_url:       robotForm.agv_url,
        arm_url:       robotForm.arm_url,
      });
      setRobotMsg('✓ Saved'); setRobotRestart(r.restart_required); reload();
    } catch (e) { setRobotMsg(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setRobotSaving(false); }
  };

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

  const saveExploreMode = async () => {
    setExpSaving(true); setExploreMsg('');
    try {
      await api.setExploreMode(exploreMode);
      setExploreMsg('✓ Saved — takes effect on next exploration run');
      reloadExploreConf();
    } catch (e) {
      setExploreMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExpSaving(false);
    }
  };

  if (loading) return <p className="text-muted">Loading configuration…</p>;

  const allAliases = (config?.devices ?? []).map(d => d.alias);

  return (
    <div>
      {/* Robot Setup sub-page link — required before real-robot test runs */}
      {config?.robot_backend === 'real' && (
        <div className="card section" style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--yellow)' }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>Robot testing</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Verify Robot, Kiosk and Camera are ready before running real-robot tests.
            </div>
          </div>
          <button onClick={() => onNav?.('robot-setup')}
            style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Open Robot Setup →
          </button>
        </div>
      )}

      {/* Robot connection (editable) */}
      <div className="card section">
        <div className="section-title">Robot Connection</div>

        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', margin: '10px 0 6px' }}>Robot Backend</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['demo', 'playwright', 'real'] as const).map(b => {
            const sel = robotForm.robot_backend === b;
            return (
              <button key={b} onClick={() => setRobotForm(f => ({ ...f, robot_backend: b }))}
                style={{
                  padding: '8px 16px', borderRadius: 7, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize',
                  border: `1px solid ${sel ? '#6366f1' : 'var(--border)'}`,
                  background: sel ? 'color-mix(in srgb, #6366f1 16%, transparent)' : 'var(--surface)',
                  color: sel ? 'var(--text)' : 'var(--muted)', fontWeight: sel ? 600 : 400,
                }}>
                {b}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 560, marginTop: 14 }}>
          {([
            ['agv_url', 'AGV Base URL', 'http://192.168.1.101:8000', 'mobile base — /base/* endpoints'],
            ['arm_url', 'Arm URL',      'http://192.168.1.100:8000', 'arm, camera, screen & card endpoints'],
          ] as [ 'agv_url' | 'arm_url', string, string, string ][]).map(([key, label, ph, hint]) => (
            <div key={key}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
              <input value={robotForm[key]} disabled={robotForm.robot_backend !== 'real'} placeholder={ph}
                onChange={e => setRobotForm(f => ({ ...f, [key]: e.target.value }))}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13,
                  background: robotForm.robot_backend === 'real' ? 'var(--bg)' : 'var(--surface)',
                  color: robotForm.robot_backend === 'real' ? 'var(--text)' : 'var(--muted)',
                  cursor: robotForm.robot_backend === 'real' ? 'text' : 'not-allowed',
                  opacity: robotForm.robot_backend === 'real' ? 1 : 0.55,
                }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</span>
            </div>
          ))}
        </div>

        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {robotForm.robot_backend === 'real'
            ? <>The AGV base and arm may be on separate IPs. <code>/api/v1</code> is appended automatically; leave a field blank to fall back to <code>{robotForm.robot_ip || '192.168.1.100'}:{robotForm.robot_port}</code>. Verify health in <strong>Robot Setup</strong>.</>
            : <>These URLs apply only to the <code>real</code> backend. <code>{robotForm.robot_backend}</code> runs in-browser (Playwright) or scripted (demo).</>}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button onClick={saveRobot} disabled={robotSaving}
            style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #6366f1', background: '#6366f1', color: '#fff', cursor: robotSaving ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            {robotSaving ? 'Saving…' : 'Save robot connection'}
          </button>
          {robotMsg && <span style={{ fontSize: 12, color: robotMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{robotMsg}</span>}
        </div>
        {robotRestart && (
          <p style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 8 }}>
            ⚠ Backend changed — restart the API server for it to take effect for test runs (IP / port apply immediately).
          </p>
        )}

        <div className="grid-4" style={{ marginTop: 18 }}>
          <InfoTile label="Robot ID"  value={config?.robot_id ?? '—'} />
          <InfoTile label="Viewport"  value={`${config?.viewport.width}×${config?.viewport.height}`} />
          <InfoTile label="Camera"    value={`${config?.camera.width}×${config?.camera.height}`} />
          <InfoTile label="Explore"   value={config?.exploration_mode ?? '—'} />
        </div>
      </div>

      {/* ── App Exploration Mode ───────────────────────────────────────────── */}
      {exploreConf && (
        <div className="card section">
          <div className="section-title">App Exploration Mode</div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
            Controls how the <strong>App Explorer</strong> discovers UI elements when mapping a new kiosk.
            This setting applies to the next exploration run — it does not affect tests already in progress.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            {/* ── Claude Vision ── */}
            <label
              style={{
                flex: 1, minWidth: 220,
                border: `2px solid ${exploreMode === 'claude' ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                background: exploreMode === 'claude' ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
                transition: 'all 0.15s',
              }}
            >
              <input
                type="radio" name="explore_mode" value="claude"
                checked={exploreMode === 'claude'}
                onChange={() => setExplMode('claude')}
                style={{ marginRight: 8 }}
              />
              <strong>Claude Vision</strong>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                Takes a screenshot and sends it to Claude to identify elements and their coordinates.
                Works with <strong>all backends</strong> (demo, playwright, real robot).
                <br />
                <span style={{ color: 'var(--green)', fontWeight: 500 }}>✓ Default</span>
              </div>
            </label>

            {/* ── Playwright ARIA ── */}
            <label
              style={{
                flex: 1, minWidth: 220,
                border: `2px solid ${exploreMode === 'playwright_aria' ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10, padding: '14px 16px',
                cursor: exploreConf.locked ? 'not-allowed' : 'pointer',
                background: exploreConf.locked
                  ? 'var(--bg)'
                  : exploreMode === 'playwright_aria'
                    ? 'rgba(99,102,241,0.06)'
                    : 'var(--surface)',
                opacity: exploreConf.locked ? 0.55 : 1,
                transition: 'all 0.15s',
              }}
            >
              <input
                type="radio" name="explore_mode" value="playwright_aria"
                checked={exploreMode === 'playwright_aria'}
                disabled={exploreConf.locked}
                onChange={() => !exploreConf.locked && setExplMode('playwright_aria')}
                style={{ marginRight: 8 }}
              />
              <strong>Playwright ARIA</strong>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                Reads the browser's accessibility tree directly — zero LLM image calls during exploration.
                Faster and more accurate coordinates. Requires <code>playwright</code> backend.
                {exploreConf.locked && (
                  <div style={{ marginTop: 6, color: 'var(--yellow)', fontWeight: 500 }}>
                    ⚠ Not available — current backend is <code>real</code> (no browser access).
                  </div>
                )}
              </div>
            </label>
          </div>

          {/* Effective mode badge */}
          {exploreConf.effective_mode !== exploreConf.mode && (
            <div className="card card-sm" style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)', marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--yellow)' }}>
                ⚠ <strong>Mode overridden</strong> — configured as <code>{exploreConf.mode}</code> but
                running as <code>{exploreConf.effective_mode}</code> because the robot backend is <code>real</code>.
              </p>
            </div>
          )}

          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={saveExploreMode}
              disabled={exploreSaving || exploreMode === exploreConf.mode}
            >
              {exploreSaving ? '⏳ Saving…' : '💾 Save Mode'}
            </button>
            {exploreMsg && (
              <span style={{ fontSize: 12, color: exploreMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
                {exploreMsg}
              </span>
            )}
            {exploreMode === exploreConf.mode && !exploreMsg && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Current: <strong>{exploreConf.effective_mode}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Device Map ─────────────────────────────────────────────────────── */}
      <div className="card section">
        <div className="section-title">Device Map</div>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
          One-time setup. Add every physical device the robot must visit during tests — use the
          abbreviations your team writes in test steps (<strong>TVM</strong>,&nbsp;
          <strong>MPOS</strong>, etc.) and map each to its <strong>Kiosk-ID</strong> (which links the
          app map explored for that device) and its position. Claude reads this map when generating
          plans, tags each step with the target device, and the robot moves to that device's position
          before interacting with its touchscreen.
        </p>

        {/* Existing device table */}
        {allAliases.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Alias</th><th>Kiosk-ID</th><th>Description</th><th>X (m)</th><th>Y (m)</th><th>θ (°)</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(config!.devices).map(d => (
                  <tr key={d.alias} style={{ cursor: 'pointer' }} onClick={() => setDevice({ ...d })}>
                    <td>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: deviceColor(d.alias, allAliases), marginRight: 7 }} />
                      <strong style={{ fontFamily: 'monospace', fontSize: 12, color: deviceColor(d.alias, allAliases) }}>{d.alias}</strong>
                    </td>
                    <td className="monospace" style={{ fontSize: 12, color: d.kiosk_id ? 'var(--accent2)' : 'var(--muted)' }}>{d.kiosk_id || '—'}</td>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 10, marginBottom: 10 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Alias <span style={{ color: 'var(--red)' }}>*</span></label>
              <input className="form-input" value={device.alias}
                onChange={e => setDevice(d => ({ ...d, alias: e.target.value.toUpperCase() }))}
                placeholder="TVM" style={{ fontFamily: 'monospace', textTransform: 'uppercase' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Kiosk-ID</label>
              <input className="form-input" value={device.kiosk_id}
                onChange={e => setDevice(d => ({ ...d, kiosk_id: e.target.value }))}
                placeholder="KIOSK-ID-1" style={{ fontFamily: 'monospace' }} />
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
            The robot taps a card on the NFC reader. Kiosk-1 issues cards; Kiosk-2 spends them.
          </p>
          <CredRow label="Card station" value="KIOSK-ID-1" />
          <CredRow label="POS kiosk"    value="KIOSK-ID-2" />

          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 14, marginBottom: 4 }}>
            Shared Card Service URL <span style={{ fontStyle: 'italic' }}>(optional)</span>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={cardSvc}
              onChange={e => setCardSvc(e.target.value)}
              placeholder="http://<host-ip>:4000  (blank = per-machine localStorage)"
              style={{ flex: 1, fontSize: 12.5, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
            <button className="btn btn-sm btn-secondary" onClick={saveCardService} disabled={cardSvcSaving}>
              {cardSvcSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
            When set, the studio appends <code>?cardServiceUrl=…</code> to the kiosk URLs so Kiosk-1 and Kiosk-2 share
            balances and transactions <strong>across machines</strong> (run the service in <code>robotics-kiosk-pos/card-service</code>).
            Leave blank to use each browser's local storage (single-machine default).
          </p>
          {cardSvcMsg && (
            <p style={{ fontSize: 12, marginTop: 4, color: cardSvcMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{cardSvcMsg}</p>
          )}

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
