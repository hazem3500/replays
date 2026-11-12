import { TerminalIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import type { ReplayConsoleEntry } from '../../../shared/replay.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { Button } from '@/components/ui/button.tsx';
import { useCarriedFilter } from '../carried-filters.ts';
import { Empty } from '../Empty.tsx';
import { ConsoleDetail } from './ConsoleDetail.tsx';
import { ConsoleList } from './ConsoleList.tsx';
import { ConsoleToolbar } from './ConsoleToolbar.tsx';
import { filterRows, groupRepeats, levelCounts } from './model.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the panel shares the network panel's frame and toolbar styles.
import '../network/network.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: the panel's styles load with the lazy inspector chunk, not with every page.
import './console.css';

/** Narrower than this, the detail takes the list's place instead of sitting beside it. */
const SIDE_DETAIL_MIN_WIDTH = 760;

const STRINGS = {
  humanTitle: 'Console wasn’t recorded',
  human: 'This recording was imported from rrweb, so console and network weren’t captured.',
  noneTitle: 'No console output was recorded',
  none: 'Nothing was logged during this session.',
  noMatchTitle: 'No matching messages',
  noMatch: 'Nothing matches these filters.',
  clear: 'Show every message',
};

function emptyCopy(total: number, human: boolean) {
  if (total) return { title: STRINGS.noMatchTitle, body: STRINGS.noMatch };
  return human ? { title: STRINGS.humanTitle, body: STRINGS.human } : { title: STRINGS.noneTitle, body: STRINGS.none };
}

/**
 * The Console tab: level chips that filter and summarise, every message in time order (identical runs folded with a
 * count), and the selected message whole, beside the list or, on a narrow panel, in its place.
 */
export function ConsolePanel({ entries, human }: { entries: readonly ReplayConsoleEntry[]; human: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const stacked = useNarrowerThan(panel, SIDE_DETAIL_MIN_WIDTH);
  const [level, setLevel] = useCarriedFilter('consoleLevel', 'all');
  const [text, setText] = useCarriedFilter('consoleText', '');
  const [selected, setSelected] = useState<string>();
  const rows = groupRepeats(entries);
  const shown = filterRows(rows, level, text);
  const counts = levelCounts(rows);
  const open = selected ? rows.find((row) => row.id === selected) : undefined;
  const copy = emptyCopy(rows.length, human);
  const empty = (
    <Empty
      icon={TerminalIcon}
      title={copy.title}
      action={
        rows.length ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLevel('all');
              setText('');
            }}
          >
            {STRINGS.clear}
          </Button>
        ) : undefined
      }
    >
      {copy.body}
    </Empty>
  );
  return (
    <div ref={panel} className="np cp" data-stacked={stacked || undefined}>
      <ConsoleToolbar counts={counts} level={level} text={text} shown={levelCounts(shown).all} onLevel={setLevel} onText={setText} />
      <div className="np-body">
        <div className="np-list" hidden={(stacked && open !== undefined) || undefined}>
          <ConsoleList rows={shown} selected={selected} onSelect={setSelected} empty={empty} />
        </div>
        {open ? <ConsoleDetail row={open} stacked={stacked} onSelect={setSelected} /> : null}
      </div>
    </div>
  );
}
