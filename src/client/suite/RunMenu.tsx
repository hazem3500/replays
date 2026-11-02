import { PinIcon, PinOffIcon } from 'lucide-react';

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu.tsx';

import { TopbarChip } from '../Topbar.tsx';
import { sequenceLabel, statusTone, TONE_LABELS, type WorkspaceRun } from './run-rows.ts';
import { isExpired, playableReplayId } from './runs.ts';

/** The topbar's one status chip for a suite run: a status dot and a word, never a filled block. */
export function RunStatusChip({ tone }: { tone: string }) {
  return (
    <TopbarChip data-testid="run-status">
      <span className={`status-dot tone-${tone}`} aria-hidden="true" />
      <span className="chip-word">{TONE_LABELS[tone] ?? tone}</span>
    </TopbarChip>
  );
}

/** Phones: the run picker, as a labelled radio group in the menu the topbar title opens. */
export function RunMenuItems({
  runs,
  detailed,
  selected,
  onSelect,
}: {
  runs: WorkspaceRun[];
  detailed: boolean;
  selected: string | undefined;
  onSelect: (replayId: string | undefined) => void;
}) {
  const playable = runs.filter((run) => playableReplayId(run, detailed));
  const index = playable.findIndex((run) => run.replayId === selected);
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>
        Run {index + 1} of {playable.length}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={selected ?? ''} onValueChange={(value) => onSelect(String(value))}>
        {runs.map((run) => (
          <DropdownMenuRadioItem
            key={run.id}
            value={playableReplayId(run, detailed) ?? `missing-${run.id}`}
            disabled={!playableReplayId(run, detailed)}
            closeOnClick
          >
            <span className="run-seq">{sequenceLabel(run)}</span>
            <span className="min-w-0 flex-1 truncate">{run.label}</span>
            {isExpired(run, detailed) ? <span className="text-muted-foreground">Expired</span> : null}
            <span className={`status-dot tone-${statusTone(run, detailed)}`} aria-hidden="true" />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

/** Phones: Keep (no expiry) for the whole suite, as a "More" menu item. */
export function KeepSuiteItem({ kept, pending, onFlip }: { kept: boolean; pending: boolean; onFlip(): void }) {
  return (
    <DropdownMenuItem onClick={onFlip} disabled={pending} data-testid="keep-suite">
      {kept ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />}
      {kept ? 'Suite kept' : 'Keep suite'}
      {kept ? <DropdownMenuShortcut className="tracking-normal">Release</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );
}
