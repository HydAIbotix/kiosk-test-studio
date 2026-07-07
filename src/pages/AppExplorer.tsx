import { useEffect, useRef, useState } from 'react';
import { api, type AppMap } from '../api/client';

export default function AppExplorer({ onNav }: { onNav: (p: string) => void }) {
  const [kioskUrl,   setKioskUrl]  = useState('http://localhost:5173');
  const [kioskId,    setKioskId]   = useState('K-01');
  const [status,     setStatus]    = useState<'idle'|'running'|'done'|'error'>('idle');
  const [message,    setMessage]   = useState('');
  const [existing,   setExisting]  = useState<AppMap | null>(null);
  const [clearing,   setClearing]  = useState(false);
  const [confirmClear, setConfirm] = useState<string>('');   // '' | 'ALL' | <app_id>
  const [clearMsg,   setClearMsg]  = useState('');
  const exploreIdRef = useRef('');
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getAppMap().then(m => { if (m.exists) setExisting(m); });
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  const start = async () => {
    stopPolling();
    setStatus('running');
    setMessage('Explorer launched — Playwright is navigating the kiosk. This takes 2–5 minutes.');
    setConfirm(''); setClearMsg('');
    try {
      const res = await api.startExplore(kioskUrl, kioskId);
      exploreIdRef.current = res.explore_id;

      // Poll every 4 s until the backend reports done or error
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.getExploreStatus(exploreIdRef.current);
          if (job.status === 'done') {
            stopPolling();
            setStatus('done');
            setMessage('Exploration complete. The App Map page now shows all discovered screens and elements.');
            api.getAppMap().then(m => { if (m.exists) setExisting(m); });
          } else if (job.status === 'error') {
            stopPolling();
            setStatus('error');
            setMessage(job.message || 'Exploration failed — check the uvicorn console for details.');
          }
        } catch { /* transient — keep polling */ }
      }, 4000);
    } catch (e) {
      stopPolling();
      setStatus('error');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.clearAppMap();
      setExisting(null); setConfirm(''); setStatus('idle');
      setClearMsg('Cleared all apps and their exploration screenshots.');
    } catch (e) {
      setClearMsg(`Clear failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setClearing(false); }
  };

  const clearOneApp = async (appId: string, label: string) => {
    setClearing(true);
    try {
      await api.clearAppMapApp(appId);
      setConfirm('');
      const m = await api.getAppMap();
      setExisting(m.exists ? m : null);
      setClearMsg(`Cleared "${label}" and its screenshots — other apps are untouched. Re-explore it below.`);
    } catch (e) {
      setClearMsg(`Clear failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setClearing(false); }
  };

  const screenCount  = existing ? Object.keys(existing.screens).length : 0;
  const elementCount = existing ? Object.values(existing.screens).reduce((s, sc) => s + sc.element_count, 0) : 0;
  const appList      = existing?.apps ? Object.values(existing.apps) : [];

  return (
    <div>
      {existing && (
        <div className="card section" style={{ borderColor: 'rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.06)' }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Explored Apps</div>
            <span className="spacer" />
            <button className="btn btn-secondary btn-sm" onClick={() => onNav('app-map')}>View App Map →</button>
          </div>

          {appList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {appList.map(a => (
                <div key={a.app_id} className="card card-sm" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <strong style={{ color: 'var(--text)' }}>{a.label || a.app_id}</strong>
                    <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <span className="badge badge-accent">{a.screen_count} screen{a.screen_count === 1 ? '' : 's'}</span>
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        entry: <code style={{ color: 'var(--accent2)' }}>{a.entry_screen || '—'}</code>
                      </span>
                    </div>
                  </div>
                  {confirmClear === a.app_id ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span className="text-muted" style={{ fontSize: 12 }}>Clear this app?</span>
                      <button className="btn btn-danger btn-sm" disabled={clearing} onClick={() => clearOneApp(a.app_id, a.label || a.app_id)}>
                        {clearing ? 'Clearing…' : 'Yes'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setConfirm('')}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={() => { setConfirm(a.app_id); setClearMsg(''); }}>🗑 Clear &amp; re-explore</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-accent">{screenCount} screens</span>
              <span className="badge badge-muted">{elementCount} elements</span>
              <span className="text-muted" style={{ fontSize: 12 }}>entry: <code style={{ color: 'var(--accent2)' }}>{existing.entry_screen}</code></span>
            </div>
          )}

          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            <p className="text-muted" style={{ fontSize: 12, margin: 0, flex: 1, minWidth: 220 }}>
              Clearing an app deletes only its screens and screenshots — other apps stay intact.
            </p>
            {confirmClear === 'ALL' ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="text-muted" style={{ fontSize: 12 }}>Clear everything?</span>
                <button className="btn btn-danger btn-sm" disabled={clearing} onClick={clearAll}>{clearing ? 'Clearing…' : 'Yes, clear all'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirm('')}>Cancel</button>
              </span>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => { setConfirm('ALL'); setClearMsg(''); }}>Clear ALL apps &amp; screenshots</button>
            )}
          </div>
          {clearMsg && <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{clearMsg}</p>}
        </div>
      )}

      <div className="grid-2">
        <div className="card section">
          <div className="section-title">{existing ? 'Re-explore Settings' : 'Explorer Settings'}</div>
          {existing && (
            <div className="card card-sm" style={{ borderColor: 'rgba(99,102,241,0.4)', marginBottom: 14, background: 'rgba(99,102,241,0.06)' }}>
              <p style={{ fontSize: 12, color: 'var(--accent2)' }}>
                Exploring is <strong>per Kiosk ID</strong>: this run maps the app at the URL below and merges it under
                the Kiosk ID you enter, <strong>without wiping other kiosks' maps</strong>. Re-running the same Kiosk ID
                refreshes just that app.
              </p>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Kiosk URL <span className="text-muted">(the app to explore)</span></label>
            <input className="form-input" value={kioskUrl} onChange={e => setKioskUrl(e.target.value)} placeholder="http://localhost:5173/?kiosk=card-station" />
            <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              The specific app/screen to map — e.g. <code>…/?kiosk=card-station</code> for Kiosk-1, <code>…/?kiosk=pos</code> for Kiosk-2.
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Kiosk ID <span className="text-muted">(which device this app belongs to)</span></label>
            <input className="form-input" value={kioskId} onChange={e => setKioskId(e.target.value)} placeholder="KIOSK-ID-1" />
            <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Tags this app's screens. Must match the Kiosk ID mapped to your test-case device abbreviations in
              <strong> Configuration → Device Map</strong>.
            </p>
          </div>
          <button className="btn btn-primary" onClick={start} disabled={status === 'running' || !kioskUrl}>
            {status === 'running'
              ? '⏳ Exploring…'
              : existing ? '↺ Run Fresh Exploration' : '🔍 Start Exploration'}
          </button>
          {status === 'running' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8, fontWeight: 500 }}>
                App exploration in progress. This may take some time…
              </div>
              <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: 'var(--accent)', borderRadius: 2,
                  animation: 'explore-progress 2s ease-in-out infinite',
                  width: '40%',
                }} />
              </div>
              <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                Playwright is navigating every reachable screen. Do not close the kiosk browser window.
              </p>
            </div>
          )}
          {message && status !== 'running' && (
            <div className="card card-sm" style={{
              marginTop: 14,
              borderColor: status === 'error' ? 'var(--red)' : status === 'done' ? 'var(--green)' : 'rgba(59,130,246,0.5)',
            }}>
              <p style={{ fontSize: 13 }}>{message}</p>
              {status === 'done' && <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => onNav('app-map')}>View App Map →</button>}
            </div>
          )}
        </div>

        <div className="card section">
          <div className="section-title">How App Explorer Works</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
            <Step n={1} title="Opens the kiosk in a real browser" desc="Playwright launches Chromium and navigates to your kiosk URL, including auto-login if credentials are configured." />
            <Step n={2} title="Claude vision scans each screen" desc="Every screen is screenshot-captured and sent to Claude, which identifies all interactive elements: buttons, inputs, links, and nav items." />
            <Step n={3} title="Clicks every discoverable action" desc="The agent interacts with each element, waits for the page to settle, and records the resulting screen — mapping all reachable states." />
            <Step n={4} title="Records verified pixel coordinates" desc="The DOM-verified center of each element is stored in viewport space (1400×900 px) for direct use during test execution." />
            <Step n={5} title="Deduplicates and validates" desc="Similar screens are merged, out-of-bounds coordinates corrected, and the map sanity-checked before saving." />
            <Step n={6} title="Saves the app map" desc="Written to app_map.json and loaded into the DB — no re-exploring needed for future test runs unless the UI changes." />
          </div>
          <hr className="divider" />
          <button className="btn btn-secondary" onClick={() => onNav('app-map')}>View Current App Map →</button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Tips for Accurate Exploration</div>
        <div className="grid-3" style={{ marginTop: 8, gap: 12 }}>
          <Tip icon="🔐" title="Set credentials first"
            text="Go to Configuration and enter your kiosk login email and password. Without them the explorer only maps public screens (usually just sign-in), missing everything behind authentication." />
          <Tip icon="🖥️" title="Keep the kiosk app running"
            text="The kiosk URL must stay accessible throughout exploration. For local dev, start the kiosk dev server first. For a deployed device, ensure the network connection is stable." />
          <Tip icon="🔄" title="Re-explore after UI changes"
            text="If a new screen, button, or input field is added to the kiosk app, run exploration again. Stale coordinates cause the vision agent to mis-tap elements and fail tests." />
          <Tip icon="📍" title="Coordinates are viewport-relative"
            text="All stored coordinates use browser viewport space (1400×900 px). In real-robot mode they are automatically scaled to camera resolution — no manual conversion needed." />
          <Tip icon="⏱️" title="Allow 2–5 minutes"
            text="A 10–15 screen kiosk typically takes ~3 minutes. Each screen needs a Claude vision API call and screenshot. Do not close the browser during exploration." />
          <Tip icon="✅" title="Verify the map after exploring"
            text="Open App Map and confirm all expected screens appear. Click each screen card to verify element count and coordinates look correct. If a screen is missing, check whether the explorer could reach it (login, popups, modals)." />
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, color: '#fff' }}>{n}</div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

function Tip({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="card card-sm">
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: 'var(--text)' }}>{title}</div>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}
