import type { DiffLine } from '../../shared/line-diff.ts';

/** A unified line diff: added lines green, removed red, unchanged dimmed; long unchanged runs are folded. */
export function DiffView({ diff, testId }: { diff: readonly DiffLine[]; testId?: string }) {
  const rows: Array<DiffLine | { kind: 'fold'; count: number }> = [];
  for (let i = 0; i < diff.length; ) {
    const line = diff[i]!;
    if (line.kind !== 'same') {
      rows.push(line);
      i++;
      continue;
    }
    let end = i;
    while (end < diff.length && diff[end]!.kind === 'same') end++;
    const run = diff.slice(i, end);
    const head = i === 0 ? 0 : 3;
    const tail = end === diff.length ? 0 : 3;
    if (run.length > head + tail + 4)
      rows.push(...run.slice(0, head), { kind: 'fold', count: run.length - head - tail }, ...run.slice(run.length - tail));
    else rows.push(...run);
    i = end;
  }
  const unchanged = diff.every((line) => line.kind === 'same');
  return (
    <pre className="mall-diff" data-testid={testId} aria-label="Changes">
      {unchanged ? <span className="mall-diff-same">No changes.</span> : null}
      {unchanged
        ? null
        : rows.map((row, index) =>
            row.kind === 'fold' ? (
              <span key={index} className="mall-diff-fold">
                {`  … ${row.count} unchanged lines\n`}
              </span>
            ) : (
              <span key={index} className={`mall-diff-${row.kind}`} data-kind={row.kind}>
                {`${row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '}${row.text}\n`}
              </span>
            ),
          )}
    </pre>
  );
}
