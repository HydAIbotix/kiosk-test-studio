import { runScreenshotUrl, type StepResult } from '../api/client';

/** "After" screenshot thumbnail for a single step (playwright runs). Click to open
 *  full-size. Renders nothing when the step has no stored screenshot (real-robot
 *  runs, skipped steps). A thumbnail whose file is missing hides itself. */
export default function StepShots({ runId, step }: { runId: string; step: StepResult }) {
  if (!step.screenshot_after) return null;
  const url = runScreenshotUrl(runId, step.screenshot_after);
  return (
    <div style={{ marginTop: 5 }}>
      <a href={url} target="_blank" rel="noreferrer" title="after — click to enlarge"
         style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
        <img src={url} alt="after" loading="lazy"
             style={{ height: 48, maxWidth: 90, objectFit: 'cover', borderRadius: 4,
                      border: '1px solid var(--border)', display: 'block' }}
             onError={e => {
               const a = e.currentTarget.parentElement as HTMLElement | null;
               if (a) a.style.display = 'none';
             }} />
        <span style={{ fontSize: 9, color: 'var(--muted)' }}>after</span>
      </a>
    </div>
  );
}
