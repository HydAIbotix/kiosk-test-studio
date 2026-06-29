type Status = 'pending' | 'running' | 'completed' | 'failed' | string;

const MAP: Record<string, { cls: string; dot: string; label: string }> = {
  pending:   { cls: 'badge-muted',  dot: 'dot-muted',  label: 'Pending' },
  running:   { cls: 'badge-blue',   dot: 'dot-yellow',  label: 'Running' },
  completed: { cls: 'badge-green',  dot: 'dot-green',  label: 'Done' },
  failed:    { cls: 'badge-red',    dot: 'dot-red',    label: 'Failed' },
  passed:    { cls: 'badge-green',  dot: 'dot-green',  label: 'Passed' },
  idle:      { cls: 'badge-muted',  dot: 'dot-muted',  label: 'Idle' },
  moving:    { cls: 'badge-blue',   dot: 'dot-yellow',  label: 'Moving' },
  error:     { cls: 'badge-red',    dot: 'dot-red',    label: 'Error' },
};

export default function StatusBadge({ status }: { status: Status }) {
  const m = MAP[status] ?? { cls: 'badge-muted', dot: 'dot-muted', label: status };
  return (
    <span className={`badge ${m.cls}`}>
      <span className={`dot ${m.dot}${status === 'running' ? ' blink' : ''}`} />
      {m.label}
    </span>
  );
}
