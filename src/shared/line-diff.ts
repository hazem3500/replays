/** A line diff for the editor's "what changed" views (versions, approval prompt): the longest common subsequence of lines. */
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // why: trim the shared head and tail first: edits are usually small, and the table below is O(n·m).
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const table: number[][] = Array.from({ length: x.length + 1 }, () => Array.from({ length: y.length + 1 }, () => 0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i++]! });
      j++;
    } else if (j < y.length && (i === x.length || table[i]![j + 1]! > table[i + 1]![j]!)) out.push({ kind: 'add', text: y[j++]! });
    else out.push({ kind: 'del', text: x[i++]! });
  }
  return [...out, ...a.slice(a.length - tail).map((text): DiffLine => ({ kind: 'same', text }))];
}

export const hasChanges = (diff: readonly DiffLine[]) => diff.some((line) => line.kind !== 'same');
