import { type CSSProperties, useState } from 'react';

import { formatClock, type ReplayBundle } from '../../../shared/replay.ts';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import type { MeetingClock } from './clock.ts';
import type { TileModel } from './tiles.ts';

export const ALIGN_STRINGS = {
  title: 'Start together',
  description:
    'Choose the same moment in each recording, such as the click that starts the scenario. That moment becomes zero for all of them; playback speed is never changed',
  start: 'Start at (seconds)',
  step: 'Recorded step',
  chooseStep: 'Choose a step',
  current: 'Use current moment',
  delay: 'A negative start holds the tile on its first frame for that long',
  reset: 'Use recording starts',
  apply: 'Align starts',
} as const;

/** Scenario starts for every loaded tile, applied together: never stretched or inferred from labels. */
export function AlignPanel({
  open,
  onOpenChange,
  tiles,
  bundles,
  offsets,
  clock,
  onAlign,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  tiles: TileModel[];
  bundles: Readonly<Record<string, ReplayBundle>>;
  offsets: Readonly<Record<string, number>>;
  clock: MeetingClock;
  onAlign(starts: Record<string, number>): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mt-align sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[length:var(--text-md)] font-semibold">{ALIGN_STRINGS.title}</DialogTitle>
          <DialogDescription>{ALIGN_STRINGS.description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <AlignForm tiles={tiles} bundles={bundles} offsets={offsets} clock={clock} onAlign={onAlign} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AlignForm({
  tiles,
  bundles,
  offsets,
  clock,
  onAlign,
  onDone,
}: {
  tiles: TileModel[];
  bundles: Readonly<Record<string, ReplayBundle>>;
  offsets: Readonly<Record<string, number>>;
  clock: MeetingClock;
  onAlign(starts: Record<string, number>): void;
  onDone(): void;
}) {
  const [starts, setStarts] = useState<Record<string, number>>(() =>
    Object.fromEntries(tiles.map((tile) => [tile.id, offsets[tile.id] ?? 0])),
  );
  const set = (id: string, value: number) => setStarts((current) => ({ ...current, [id]: value }));
  return (
    <form
      className="mt-align-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAlign(starts);
        onDone();
      }}
    >
      <p className="mt-align-note">{ALIGN_STRINGS.delay}</p>
      <ul className="mt-align-list">
        {tiles.map((tile) => {
          const steps = bundles[tile.id]?.steps ?? [];
          const value = starts[tile.id] ?? 0;
          const stepIndex = steps.findIndex((step) => step.at === value);
          return (
            <li key={tile.id} className="mt-align-row" style={{ '--tile': `var(--tile-${tile.colour + 1})` } as CSSProperties}>
              <span className="mt-letter" aria-hidden="true">
                {tile.letter}
              </span>
              <fieldset>
                <legend>{tile.label}</legend>
                <label>
                  <span>{ALIGN_STRINGS.start}</span>
                  <input
                    type="number"
                    step="0.1"
                    min={-86_400}
                    max={tile.duration / 1000}
                    value={Math.round(value / 100) / 10}
                    onChange={(event) =>
                      Number.isFinite(event.target.valueAsNumber) && set(tile.id, Math.round(event.target.valueAsNumber * 1000))
                    }
                  />
                </label>
                <label>
                  <span>{ALIGN_STRINGS.step}</span>
                  <select
                    value={stepIndex < 0 ? '' : String(stepIndex)}
                    disabled={!steps.length}
                    onChange={(event) => {
                      const step = steps[Number(event.target.value)];
                      if (event.target.value && step) set(tile.id, step.at);
                    }}
                  >
                    <option value="">{ALIGN_STRINGS.chooseStep}</option>
                    {steps.map((step, index) => (
                      <option key={index} value={index}>
                        {index + 1}. {step.label} · {formatClock(step.at)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="button" variant="outline" size="sm" onClick={() => set(tile.id, Math.round(clock.localTime(tile.id)))}>
                  {ALIGN_STRINGS.current}
                </Button>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onAlign({});
            onDone();
          }}
        >
          {ALIGN_STRINGS.reset}
        </Button>
        <Button type="submit">{ALIGN_STRINGS.apply}</Button>
      </DialogFooter>
    </form>
  );
}
