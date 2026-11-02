import { ms } from './detect.ts';
import type { Issue } from './types.ts';

/** A headline piece; `strong` marks what the reader should see first (the action, the status). */
export interface HeadlinePart {
  text: string;
  strong?: boolean;
}

const STRINGS = {
  none: 'No problems found in this replay.',
  action: (label: string | undefined) => label ?? 'a request',
  rejected: 'the server rejected ',
  failed: 'the server failed on ',
  timeout: (duration: string) => ` got no response (gave up after ${duration})`,
  error: 'the page logged an error',
  during: ' during ',
  slow: (value: number) => ` was slow to respond (${ms(value)})`,
  busy: ' because the page was busy',
  froze: (value: number) => `the page froze for ${ms(value)}`,
  after: ' after ',
  slowRequest: (short: string) => short.replace(/^Slow /, ''),
  took: (value: number) => ` took ${ms(value)}`,
  paint: (value: number) => `the main content painted late (${ms(value)})`,
  more: (count: number) => `${count} more ${count === 1 ? 'problem' : 'problems'}`,
  recovered: ' A retry recovered.',
};

/** The action label behind an issue (from its chain), quoted when present. */
function actionOf(issue: Issue) {
  return issue.chain.find((link) => link.role === 'trigger')?.label;
}

function quoted(label: string | undefined): HeadlinePart {
  return { text: label ? `“${label}”` : STRINGS.action(label), strong: Boolean(label) };
}

function clause(issue: Issue): HeadlinePart[] {
  const action = actionOf(issue);
  switch (issue.kind) {
    case 'failed-request': {
      const cause = issue.chain.find((link) => link.role === 'cause');
      const status = cause?.detail?.split(' · ')[0] ?? '';
      if (issue.layer === 'network') return [quoted(action), { text: STRINGS.timeout(cause?.detail?.split(' · ')[1] ?? '') }];
      return [
        { text: Number(status) >= 500 ? STRINGS.failed : STRINGS.rejected },
        quoted(action),
        { text: ' (' },
        { text: status, strong: true },
        { text: ')' },
      ];
    }
    case 'console-error':
      return [{ text: STRINGS.error }, ...(action ? [{ text: STRINGS.during }, quoted(action)] : [])];
    case 'slow-interaction':
      return [
        quoted(action),
        { text: STRINGS.slow(issue.value ?? 0) },
        ...(issue.reason.includes('blocked the main thread') ? [{ text: STRINGS.busy }] : []),
      ];
    case 'long-task':
      return [{ text: STRINGS.froze(issue.value ?? 0) }, ...(action ? [{ text: STRINGS.after }, quoted(action)] : [])];
    case 'slow-request':
      return [{ text: STRINGS.slowRequest(issue.short), strong: true }, { text: STRINGS.took(issue.value ?? 0) }];
    case 'slow-paint':
      return [{ text: STRINGS.paint(issue.value ?? 0) }];
  }
}

/**
 * One sentence over the issues (the most important three): "The server rejected “Apply the coupon” (404), and “Place
 * the order” was slow to respond (208 ms) because the page was busy." Pieces, so a UI can emphasise the actions.
 */
export function headlineParts(issues: readonly Issue[]): HeadlinePart[] {
  if (!issues.length) return [{ text: STRINGS.none }];
  const shown = issues.slice(0, 3).map(clause);
  const rest = issues.length - shown.length;
  const clauses = rest > 0 ? [...shown, [{ text: STRINGS.more(rest) }]] : shown;
  const parts: HeadlinePart[] = [];
  clauses.forEach((pieces, index) => {
    if (index > 0) parts.push({ text: index === clauses.length - 1 ? (clauses.length > 2 ? ', and ' : ' and ') : ', ' });
    parts.push(...pieces);
  });
  const first = parts[0]!;
  parts[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) };
  parts.push({ text: '.' });
  if (issues.some((issue) => issue.chain.some((link) => link.role === 'retry'))) parts.push({ text: STRINGS.recovered });
  return parts;
}

export function headline(issues: readonly Issue[]) {
  return headlineParts(issues)
    .map((part) => part.text)
    .join('');
}
