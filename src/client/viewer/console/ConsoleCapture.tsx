import type { ReplayConsoleEntry, ReplayMeta } from '../../../shared/replay.ts';
import { NotCaptured } from '../NotCaptured.tsx';
import { ConsolePanel } from './ConsolePanel.tsx';
export function ConsoleCapture({ entries, human, meta }: { entries: ReplayConsoleEntry[]; human: boolean; meta: ReplayMeta }) {
  const captured = meta.captured?.console ?? !human;
  if (!entries.length && !captured) return <NotCaptured track="console" meta={meta} testId="console-not-captured" />;
  return <ConsolePanel entries={entries} human={human} />;
}
