import { runScreenshotUrl, type StepResult } from '../api/client';

/** Before/After screenshot thumbnails for a single step. On the REAL robot a tap saves a "before"
 *  frame (crosshair at the exact camera pixel it will touch) and an "after" frame (the /screen/click
 *  response image); playwright runs save only an "after". Click a thumbnail to open full-size.
 *  Renders nothing when the step has no stored screenshots (skipped steps, demo). A thumbnail whose
 *  file is missing hides itself. */
export default function StepShots({ runId, step }: { runId: string; step: StepResult }) {
  const shots: Array<{ label: string; path: string }> = [];
  if (step.screenshot_before) shots.push({ label: 'before', path: step.screenshot_before });
  if (step.screenshot_after) shots.push({ label: 'after', path: step.screenshot_after });
  if (!shots.length) return null;
  return (
    <div style={{ marginTop: 5, display: 'flex', gap: 8 }}>
      {shots.map(({ label, path }) => {
        const url = runScreenshotUrl(runId, path);
        return (
          <a key={label} href={url} target="_blank" rel="noreferrer" title={`${label} — click to enlarge`}
             style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
            <img src={url} alt={label} loading="lazy"
                 style={{ height: 48, maxWidth: 90, objectFit: 'cover', borderRadius: 4,
                          border: '1px solid var(--border)', display: 'block' }}
                 onError={e => {
                   const a = e.currentTarget.parentElement as HTMLElement | null;
                   if (a) a.style.display = 'none';
                 }} />
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>{label}</span>
          </a>
        );
      })}
    </div>
  );
}
