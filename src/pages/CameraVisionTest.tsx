import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, type VisionCapture, type VisionAnalysis, type AppMap } from '../api/client';

/**
 * Camera Vision Test — a self-contained diagnostic page to answer one question:
 * "are the robot camera frames good enough for our automation, and at which tier?"
 *
 *   1. Capture a frame via the robot arm /capture API (spec `type` = screen | raw), OR upload a
 *      frame already captured from the robot.
 *   2. Run the SAME detection pipeline the live system uses on that frame:
 *        • Tier-1 aHash screen match vs the app_map (0 LLM)  → can we ID the screen without Claude?
 *        • OpenCV boundary detection (0 LLM)                 → are element boundaries clear?
 *        • OCR text (0 LLM)                                  → is on-screen text legible?
 *        • Claude vision element analysis (Tier-3, optional) → what does the model read?
 *   3. Overlay the detected boxes/points on the frame and print a tier recommendation.
 */

const card: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 18, marginBottom: 18,
};
const h3: CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' };
const sub: CSSProperties = { fontSize: 12, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 };

function btn(kind: 'primary' | 'ghost', disabled = false): CSSProperties {
  return {
    padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
    border: kind === 'primary' ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: kind === 'primary' ? 'var(--accent)' : 'var(--surface2)',
    color: kind === 'primary' ? '#fff' : 'var(--text)',
  };
}

const VERDICT_COLOR: Record<string, string> = {
  match: 'var(--green)', no_match: 'var(--red)',
  inconclusive: 'var(--amber, #f59e0b)', no_reference: 'var(--muted)',
};
const VERDICT_LABEL: Record<string, string> = {
  match: 'Tier-1 MATCH — screen identified without Claude',
  no_match: 'NO Tier-1 match — needs Tier-2/3 (Claude vision)',
  inconclusive: 'Inconclusive — Claude-vision fallback would run',
  no_reference: 'No reference hashes — explore the app first',
};

export default function CameraVisionTest() {
  const [appMap,   setAppMap]   = useState<AppMap | null>(null);
  const [capture,  setCapture]  = useState<VisionCapture | null>(null);
  const [analysis, setAnalysis] = useState<VisionAnalysis | null>(null);
  const [busy,     setBusy]     = useState<string>('');   // '', 'screen', 'raw', 'upload', 'analyze'
  const [error,    setError]    = useState('');
  const [useClaude, setUseClaude] = useState(false);
  const [expected, setExpected]   = useState('');
  const [show, setShow] = useState<{ opencv: boolean; claude: boolean }>({ opencv: true, claude: true });
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { api.getAppMap().then(setAppMap).catch(() => {}); }, []);

  const screenIds = useMemo(
    () => Object.keys(appMap?.screens ?? {}).sort(),
    [appMap],
  );

  const doCapture = async (kind: 'screen' | 'raw') => {
    setBusy(kind); setError(''); setAnalysis(null);
    try { setCapture(await api.visionTestCapture(kind)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setCapture(null); }
    finally { setBusy(''); }
  };

  const doUpload = async (f: File) => {
    setBusy('upload'); setError(''); setAnalysis(null);
    try { setCapture(await api.visionTestUpload(f)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setCapture(null); }
    finally { setBusy(''); }
  };

  const doAnalyze = async () => {
    if (!capture) return;
    setBusy('analyze'); setError('');
    try {
      setAnalysis(await api.visionTestAnalyze({
        filename: capture.filename,
        expected_screen: expected || undefined,
        use_claude: useClaude,
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  // Natural (server) image dimensions used for overlay scaling; analysis reports them.
  const imgW = analysis?.width ?? capture?.width ?? 0;
  const imgH = analysis?.height ?? capture?.height ?? 0;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={card}>
        <p style={h3}>Why this page</p>
        <p style={{ ...sub, marginBottom: 0 }}>
          The whole automation depends on how much we can read from real robot-camera frames.
          Capture a frame straight from the arm’s <code>/capture</code> API (or upload one), then run
          the exact same detection the App Explorer and screen validation use — screen match (Tier-1,
          no&nbsp;LLM), element boundaries, OCR text, and optional Claude vision — to see whether these
          frames support Tier-1 or need Tier-2/3.
        </p>
      </div>

      {/* ── 1. Capture ──────────────────────────────────────────────── */}
      <div style={card}>
        <p style={h3}>1 · Capture a frame</p>
        <p style={sub}>
          <code>type: "screen"</code> returns the AprilTag-rectified, cropped kiosk screen (what taps
          are computed against). <code>type: "raw"</code> returns the unrectified sensor frame (useful
          to judge glare/blur/perspective before rectification). Calls the arm controller directly and
          does not affect live calibration.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={btn('primary', !!busy)} disabled={!!busy} onClick={() => doCapture('screen')}>
            {busy === 'screen' ? 'Capturing…' : '📷 Capture (type=screen)'}
          </button>
          <button style={btn('ghost', !!busy)} disabled={!!busy} onClick={() => doCapture('raw')}>
            {busy === 'raw' ? 'Capturing…' : 'Capture (type=raw)'}
          </button>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>or</span>
          <button style={btn('ghost', !!busy)} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' ? 'Uploading…' : '⬆ Upload a frame'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''; }} />
        </div>
        {error && (
          <p style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>✗ {error}</p>
        )}
        {capture && (
          <div style={{ marginTop: 14, display: 'flex', gap: 18, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span><b style={{ color: 'var(--text)' }}>{capture.capture_type}</b> frame</span>
            <span>{capture.width}×{capture.height}px{capture.aspect ? ` (${capture.aspect}:1)` : ''}</span>
            <span>{(capture.bytes / 1024).toFixed(0)} KB</span>
            {capture.elapsed_ms > 0 && <span>{capture.elapsed_ms} ms</span>}
            {capture.controller && <span>via {capture.controller}</span>}
          </div>
        )}
      </div>

      {/* ── 2. Detect ───────────────────────────────────────────────── */}
      {capture && (
        <div style={card}>
          <p style={h3}>2 · Run detection on this frame</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text)' }}>
              <input type="checkbox" checked={useClaude} onChange={e => setUseClaude(e.target.checked)} />
              Also run Claude vision (Tier-3, ~1 LLM call)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--muted)' }}>
              Expected screen (optional):
              <select value={expected} onChange={e => setExpected(e.target.value)}
                      style={{ padding: '5px 8px', borderRadius: 6, background: 'var(--surface2)',
                               color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12 }}>
                <option value="">— none —</option>
                {screenIds.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button style={btn('primary', busy === 'analyze')} disabled={busy === 'analyze'} onClick={doAnalyze}>
              {busy === 'analyze' ? 'Analyzing…' : '▶ Run Detection'}
            </button>
          </div>

          {/* Image + overlays */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 460px', minWidth: 320,
                          border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
                          background: '#000', alignSelf: 'flex-start' }}>
              <img src={capture.image_url} alt="camera frame"
                   style={{ display: 'block', width: '100%', height: 'auto' }} />
              {/* OpenCV boundary boxes */}
              {show.opencv && analysis && imgW > 0 && imgH > 0 && analysis.opencv.rects.map((r, i) => (
                <div key={`o${i}`} style={{
                  position: 'absolute',
                  left:   `${(r.bbox[0] / imgW) * 100}%`,
                  top:    `${(r.bbox[1] / imgH) * 100}%`,
                  width:  `${((r.bbox[2] - r.bbox[0]) / imgW) * 100}%`,
                  height: `${((r.bbox[3] - r.bbox[1]) / imgH) * 100}%`,
                  border: '2px solid #22d3ee', borderRadius: 3,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
                }} />
              ))}
              {/* Claude element centers */}
              {show.claude && analysis?.claude?.elements && imgW > 0 && imgH > 0 &&
                analysis.claude.elements.map((el, i) => (
                <div key={`c${i}`} title={`${el.id} (${el.type})`} style={{
                  position: 'absolute',
                  left: `${(el.center[0] / imgW) * 100}%`,
                  top:  `${(el.center[1] / imgH) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 12, height: 12, borderRadius: '50%',
                  border: '2px solid #f472b6', background: 'rgba(244,114,182,0.35)',
                }} />
              ))}
            </div>

            {/* Legend / toggles */}
            {analysis && (
              <div style={{ flex: '1 1 260px', minWidth: 240, fontSize: 12.5 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={show.opencv} onChange={e => setShow(s => ({ ...s, opencv: e.target.checked }))} />
                  <span style={{ width: 14, height: 3, background: '#22d3ee', display: 'inline-block' }} />
                  OpenCV boundaries — <b>{analysis.opencv.count}</b> box{analysis.opencv.count === 1 ? '' : 'es'}
                </label>
                {analysis.claude?.elements && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={show.claude} onChange={e => setShow(s => ({ ...s, claude: e.target.checked }))} />
                    <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #f472b6', display: 'inline-block' }} />
                    Claude elements — <b>{analysis.claude.elements.length}</b>
                  </label>
                )}
                {analysis.opencv.error && <p style={{ color: 'var(--red)' }}>OpenCV: {analysis.opencv.error}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3. Results ──────────────────────────────────────────────── */}
      {analysis && (
        <>
          {/* Recommendation banner */}
          <div style={{ ...card, borderColor: VERDICT_COLOR[analysis.tier1.verdict] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: VERDICT_COLOR[analysis.tier1.verdict] }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: VERDICT_COLOR[analysis.tier1.verdict] }}>
                {VERDICT_LABEL[analysis.tier1.verdict]}
              </span>
            </div>
            <p style={{ ...sub, marginBottom: 8 }}>{analysis.tier1.detail}</p>
            <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55, margin: 0 }}>{analysis.recommendation}</p>
          </div>

          {/* Tier-1 phash ranking */}
          <div style={card}>
            <p style={h3}>Tier-1 · Perceptual-hash screen match (0 LLM)</p>
            <p style={sub}>
              aHash Hamming distance from this frame to each explored screen (0 = identical). Match
              ≤ {analysis.tier1.match_threshold}, mismatch &gt; {analysis.tier1.mismatch_threshold}.
              {analysis.tier1.expected_screen &&
                ` Expected '${analysis.tier1.expected_screen}': distance ${analysis.tier1.expected_distance ?? 'n/a'}.`}
            </p>
            {analysis.tier1.ranking.length === 0
              ? <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>No stored screen hashes — run the App Explorer first.</p>
              : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>#</th>
                    <th style={{ padding: '4px 8px' }}>Screen</th>
                    <th style={{ padding: '4px 8px' }}>App / kiosk</th>
                    <th style={{ padding: '4px 8px' }}>Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.tier1.ranking.map((r, i) => {
                    const isBest = i === 0;
                    const good = r.distance <= analysis.tier1.match_threshold;
                    return (
                      <tr key={r.screen_id} style={{ borderTop: '1px solid var(--border)',
                            background: isBest ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined }}>
                        <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--text)', fontWeight: isBest ? 700 : 400 }}>
                          {r.screen_id}{r.is_dynamic ? ' (dynamic)' : ''}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{r.app_id || '—'}</td>
                        <td style={{ padding: '5px 8px', fontWeight: 700,
                              color: good ? 'var(--green)' : (isBest ? 'var(--red)' : 'var(--muted)') }}>
                          {r.distance}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* OCR text — raw frame */}
          <div style={card}>
            <p style={h3}>Text legibility · OCR (0 LLM)</p>
            <p style={sub}>
              Tesseract read of the raw frame.
              {analysis.ocr.engine ? ` Engine: ${analysis.ocr.engine}.` : ''}
              {' '}The enhanced-frame OCR below shows whether local preprocessing recovers more text.
            </p>
            {!analysis.ocr.available
              ? <p style={{ color: 'var(--amber, #f59e0b)', fontSize: 12.5 }}>⚠ {analysis.ocr.error}</p>
              : analysis.ocr.error
                ? <p style={{ color: 'var(--red)', fontSize: 12.5 }}>{analysis.ocr.error}</p>
                : <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text)',
                                background: 'var(--surface2)', border: '1px solid var(--border)',
                                borderRadius: 6, padding: 12, maxHeight: 240, overflow: 'auto', margin: 0 }}>
                    {analysis.ocr.text || '(no text extracted from the raw frame — see enhanced below)'}
                  </pre>}
          </div>

          {/* Enhanced frame — local OpenCV preprocessing to help the cheap tiers */}
          {analysis.enhanced && (
            <div style={card}>
              <p style={h3}>Image enhancement · OpenCV preprocessing (0 LLM)</p>
              <p style={sub}>
                Local pipeline: <code>{analysis.enhanced.pipeline}</code>. A camera photo is soft,
                low-res and glare-y; this recovers legibility for OCR/edge detection. It does NOT fix
                Tier-1 aHash (that needs camera-domain references), and coordinates always come from the
                app_map — enhancement is a legibility aid, not part of the tap path.
              </p>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 380px', minWidth: 280, border: '1px solid var(--border)',
                              borderRadius: 8, overflow: 'hidden', background: '#000', alignSelf: 'flex-start' }}>
                  <img src={analysis.enhanced.image_url} alt="enhanced frame"
                       style={{ display: 'block', width: '100%', height: 'auto' }} />
                </div>
                <div style={{ flex: '1 1 320px', minWidth: 280, fontSize: 12.5 }}>
                  <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>
                    OpenCV boundaries on enhanced: <b style={{ color: 'var(--text)' }}>{analysis.enhanced.opencv_count}</b>
                    {analysis.enhanced.tier1_best &&
                      <> · nearest hash: <b style={{ color: 'var(--text)' }}>{analysis.enhanced.tier1_best.screen_id}</b> (d={analysis.enhanced.tier1_best.distance})</>}
                  </p>
                  <p style={{ margin: '0 0 6px', color: 'var(--muted)' }}>OCR (enhanced):</p>
                  {!analysis.enhanced.ocr.available
                    ? <p style={{ color: 'var(--amber, #f59e0b)' }}>⚠ {analysis.enhanced.ocr.error}</p>
                    : analysis.enhanced.ocr.error
                      ? <p style={{ color: 'var(--red)' }}>{analysis.enhanced.ocr.error}</p>
                      : <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text)',
                                      background: 'var(--surface2)', border: '1px solid var(--border)',
                                      borderRadius: 6, padding: 12, maxHeight: 220, overflow: 'auto', margin: 0 }}>
                          {analysis.enhanced.ocr.text || '(still no text — frame too blurry/low-res; improve capture focus, lighting & resolution)'}
                        </pre>}
                </div>
              </div>
            </div>
          )}

          {/* Claude elements */}
          {analysis.claude && (
            <div style={card}>
              <p style={h3}>Claude vision · element extraction (Tier-3)</p>
              {analysis.claude.error
                ? <p style={{ color: 'var(--red)', fontSize: 12.5 }}>{analysis.claude.error}</p>
                : (
                <>
                  <p style={sub}>
                    Screen: <b style={{ color: 'var(--text)' }}>{analysis.claude.screen_id}</b>
                    {analysis.claude.description ? ` — ${analysis.claude.description}` : ''}
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                        <th style={{ padding: '4px 8px' }}>Element</th>
                        <th style={{ padding: '4px 8px' }}>Type</th>
                        <th style={{ padding: '4px 8px' }}>Label</th>
                        <th style={{ padding: '4px 8px' }}>Center</th>
                        <th style={{ padding: '4px 8px' }}>Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(analysis.claude.elements ?? []).map(el => (
                        <tr key={el.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{el.id}</td>
                          <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{el.type}</td>
                          <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{el.label}</td>
                          <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{el.center[0]},{el.center[1]}</td>
                          <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>
                            {el.confidence != null ? el.confidence.toFixed(2) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
