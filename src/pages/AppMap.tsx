import { useEffect, useState } from 'react';
import { api, type AppMap } from '../api/client';

const SHOTS_BASE      = '/api/screenshots';
const ANNOTATED_BASE  = '/api/screenshots/annotated';

export default function AppMapPage() {
  const [map,          setMap]         = useState<AppMap | null>(null);
  const [selected,     setSel]         = useState<string | null>(null);
  const [appFilter,    setAppFilter]   = useState<string>('all');
  const [loading,      setLoading]     = useState(true);
  const [shots,        setShots]       = useState<string[]>([]);
  const [annotated,    setAnnotated]   = useState<Record<string, string[]>>({});
  const [shotsOpen,    setShotsOpen]   = useState(false);
  const [imgModal,     setImgModal]    = useState<{ src: string; label: string } | null>(null);
  const [confirmApp,   setConfirmApp]  = useState<string | null>(null);
  const [clearingApp,  setClearingApp] = useState(false);
  const [clearMsg,     setClearMsg]    = useState('');

  const reload = () => {
    api.getAppMap().then(m => { setMap(m); setLoading(false); });
    api.getScreenshots().then(setShots).catch(() => setShots([]));
    api.getAnnotatedScreenshots().then(setAnnotated).catch(() => setAnnotated({}));
  };

  useEffect(() => { reload(); }, []);

  const clearApp = async (appId: string, label: string) => {
    setClearingApp(true); setClearMsg('');
    try {
      await api.clearAppMapApp(appId);
      setConfirmApp(null); setAppFilter('all'); setSel(null);
      setClearMsg(`Cleared "${label}". Re-explore it from the App Explorer page (its map is now empty; other apps are untouched).`);
      reload();
    } catch (e) {
      setClearMsg(`Clear failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setClearingApp(false); }
  };

  if (loading) return <p className="text-muted">Loading app map…</p>;
  if (!map?.exists) return (
    <div className="empty-state">
      <div className="empty-icon">🗺</div>
      <div className="empty-title">No app map yet</div>
      <p>Run App Explorer first to discover the kiosk UI structure.</p>
    </div>
  );

  const apps     = map.apps ? Object.values(map.apps) : [];
  const screens  = Object.entries(map.screens).filter(
    ([, sc]) => appFilter === 'all' || (sc.app_id || '') === appFilter
  );
  const sel_sc   = selected ? map.screens[selected] : null;
  const totalEl  = screens.reduce((s, [, sc]) => s + sc.element_count, 0);

  // Annotated screenshots for the currently-selected screen
  const selAnnotated = selected ? (annotated[selected] ?? []) : [];

  return (
    <div>
      {/* App selector — filter the map by explored application (multi-app) */}
      {apps.length > 0 && (
        <div className="card section" style={{ padding: '10px 14px' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="section-title" style={{ marginBottom: 0, marginRight: 4 }}>App</span>
            <button className={`btn btn-sm ${appFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setAppFilter('all'); setSel(null); }}>
              All ({Object.keys(map.screens).length})
            </button>
            {apps.map(a => (
              <button key={a.app_id}
                className={`btn btn-sm ${appFilter === a.app_id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setAppFilter(a.app_id); setSel(null); }}
                title={`entry: ${a.entry_screen}`}>
                {a.label || a.app_id} ({a.screen_count})
              </button>
            ))}

            {/* Per-app clear — only the selected app's screens are removed (others untouched) */}
            {appFilter !== 'all' && (() => {
              const cur = apps.find(a => a.app_id === appFilter);
              const label = cur?.label || appFilter;
              return (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {confirmApp === appFilter ? (
                    <>
                      <span className="text-muted" style={{ fontSize: 12 }}>Clear <strong>{label}</strong>'s map?</span>
                      <button className="btn btn-danger btn-sm" disabled={clearingApp}
                        onClick={() => clearApp(appFilter, label)}>
                        {clearingApp ? 'Clearing…' : 'Yes, clear this app'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setConfirmApp(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={() => { setConfirmApp(appFilter); setClearMsg(''); }}
                      title={`Delete only ${label}'s screens so you can re-explore it`}>
                      🗑 Clear &amp; re-explore “{label}”
                    </button>
                  )}
                </span>
              );
            })()}
          </div>
          {clearMsg && <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{clearMsg}</p>}
          {appFilter === 'all' && apps.length > 0 && (
            <p className="text-muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              Select an app above to clear &amp; re-explore just that app. The screenshot count below is raw captures across <em>all</em> apps.
            </p>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid-4 section">
        <Stat label="Screens"        value={screens.length} />
        <Stat label="Total Elements" value={totalEl} />
        <Stat label="Entry Screen"   value={map.entry_screen || '—'} />
        <Stat label="Explored"       value={map.explored_at ? new Date(map.explored_at).toLocaleString() : 'Date not recorded'} />
      </div>

      {/* Raw exploration screenshots (collapsed by default) */}
      {shots.length > 0 && (
        <div className="card section" style={{ borderColor: 'rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.04)' }}>
          <div className="row">
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Exploration Screenshots</div>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {shots.length} raw screenshots captured during exploration.
              </p>
            </div>
            <span className="spacer" />
            <button className="btn btn-secondary btn-sm" onClick={() => setShotsOpen(o => !o)}>
              {shotsOpen ? 'Hide ▲' : `View ${shots.length} Screenshots ▼`}
            </button>
          </div>
          {shotsOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8, marginTop: 12 }}>
              {shots.map(f => (
                <button key={f} onClick={() => setImgModal({ src: `${SHOTS_BASE}/${f}`, label: f })}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', cursor: 'zoom-in', padding: 0, textAlign: 'left' }}>
                  <img src={`${SHOTS_BASE}/${f}`} alt={f}
                    style={{ width: '100%', height: 95, objectFit: 'cover', display: 'block' }}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
                  <div style={{ padding: '3px 6px', fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid-2">
        {/* Screen list */}
        <div className="card">
          <div className="section-title">Screens ({screens.length})</div>
          <div className="screen-grid" style={{ marginTop: 8 }}>
            {screens.map(([sid, sc]) => (
              <button key={sid} className="screen-card"
                style={{
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  border: `1px solid ${selected === sid ? 'var(--accent)' : 'var(--border)'}`,
                  background: selected === sid ? 'rgba(99,102,241,0.12)' : 'var(--surface2)',
                  color: 'var(--text)',
                }}
                onClick={() => setSel(sid === selected ? null : sid)}>
                <div className="row">
                  <h4 style={{ fontFamily: 'monospace', fontSize: 12 }}>{sid}</h4>
                  <span className="spacer" />
                  <span className="badge badge-accent">{sc.element_count} el</span>
                  {(annotated[sid]?.length ?? 0) > 0 && (
                    <span className="badge badge-muted" style={{ marginLeft: 4 }}>📸 {annotated[sid].length}</span>
                  )}
                </div>
                <div className="dom-id">{sc.dom_id || 'no dom-id'}</div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{sc.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="card">
          {sel_sc ? (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <div>
                  <code style={{ color: 'var(--accent2)', fontSize: 13, fontWeight: 700 }}>{selected}</code>
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{sel_sc.description}</p>
                </div>
                <span className="spacer" />
                <button className="btn btn-sm btn-secondary" onClick={() => setSel(null)}>✕</button>
              </div>

              {/* Annotated screenshots for this screen */}
              {selAnnotated.length > 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Annotated Screenshots ({selAnnotated.length})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
                    {selAnnotated.map(f => (
                      <button key={f} onClick={() => setImgModal({ src: `${ANNOTATED_BASE}/${f}`, label: f })}
                        style={{ background: 'none', border: '1px solid var(--accent)', borderRadius: 6, overflow: 'hidden', cursor: 'zoom-in', padding: 0, textAlign: 'left' }}>
                        <img src={`${ANNOTATED_BASE}/${f}`} alt={f}
                          style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }}
                          onError={e => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
                        <div style={{ padding: '3px 6px', fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                    Elements are highlighted with bounding boxes — verify coordinates are correct.
                  </p>
                </div>
              ) : (
                <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12, color: 'var(--muted)' }}>
                  No annotated screenshots for this screen yet.
                </div>
              )}

              <div className="section-title">Elements ({sel_sc.element_count})</div>
              <p className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>
                Center pixels in 1400×900 viewport space — used directly for tap commands.
              </p>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontWeight: 600 }}>ID</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontWeight: 600 }}>Label</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontWeight: 600 }}>Type</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--muted)', fontWeight: 600 }}>Center (x, y)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel_sc.elements.map(el => (
                      <tr key={el.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11, color: 'var(--accent2)' }}>{el.id}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{el.label || '—'}</td>
                        <td style={{ padding: '5px 8px' }}><span className="tag">{el.type}</span></td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)', fontSize: 11 }}>
                          ({Math.round(el.center[0])}, {Math.round(el.center[1])})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
              <p>Select a screen to view its annotated screenshots and element coordinates.</p>
            </div>
          )}
        </div>
      </div>

      {/* Full-size image modal */}
      {imgModal && (
        <div onClick={() => setImgModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', position: 'relative' }}>
            <img src={imgModal.src} alt={imgModal.label}
              style={{ maxWidth: '100%', maxHeight: '83vh', borderRadius: 8, display: 'block' }} />
            <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', marginTop: 8, fontFamily: 'monospace' }}>{imgModal.label}</div>
            <button onClick={() => setImgModal(null)}
              style={{ position: 'absolute', top: -12, right: -12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: 'var(--text)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div style={{ fontSize: typeof value === 'string' && value.length > 12 ? 12 : 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
