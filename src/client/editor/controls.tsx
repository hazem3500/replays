import { ChevronDownIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import type { ReplayEdits } from '../../shared/edits.ts';
import { SPEED_RATES, ZOOM_SCALES } from '../../shared/effects.ts';
import { formatClock } from '../../shared/replay.ts';
import { usePlayerState, usePlayhead, useViewport } from '../player.ts';
import { effectList, removeHighlight, type Selection, updateEffect, updateHighlight } from './state.ts';
import { editorStrings } from './strings.ts';

const strings = editorStrings.controls;
type Change = (edits: ReplayEdits, select?: Selection) => void;

/** Follows the player's recorded viewport, including viewport changes during playback. */
export function EditorPreviewFrame({ children }: { children: ReactNode }) {
  const viewport = useViewport();
  return (
    <div className="stage-wrap" style={{ '--editor-preview-ratio': viewport.width / viewport.height } as CSSProperties}>
      {children}
    </div>
  );
}

export function EditorPlayButton({ onSwitch }: { onSwitch: () => void }) {
  const { status } = usePlayerState();
  return (
    <IconButton
      label={status === 'playing' ? editorStrings.dock.pause : editorStrings.dock.play}
      shortcut="Space"
      tooltipAlign="start"
      className="play-button text-foreground"
      onClick={onSwitch}
      data-testid="editor-play"
    >
      <span className="icon-swap" data-state={status === 'playing' ? 'b' : 'a'} aria-hidden="true">
        <AnimatedIcon name="play" className="icon-a filled-icon" />
        <AnimatedIcon name="pause" className="icon-b filled-icon" />
      </span>
    </IconButton>
  );
}

/** The playhead on the original timeline. */
export function EditorClock() {
  const clock = usePlayhead((time) => formatClock(time));
  return (
    <span className="editor-clock" data-testid="editor-clock">
      {clock}
    </span>
  );
}

/** "0:03.2 → 0:01.9": the recording's length and what the edits leave (just the length when nothing is removed). */
export function Durations({ original, edited }: { original: number; edited: number }) {
  const changed = Math.round(edited) !== Math.round(original);
  return (
    <span
      className="editor-durations"
      role="group"
      data-testid="durations"
      aria-label={editorStrings.dock.durations(formatClock(original), changed ? formatClock(edited) : undefined)}
    >
      <span className="editor-durations-original" data-changed={changed || undefined}>
        {formatClock(original)}
      </span>
      {changed ? (
        <>
          <span aria-hidden="true">→</span>
          <strong data-testid="edited-length">{formatClock(edited)}</strong>
        </>
      ) : null}
    </span>
  );
}

export function MobilePlayback({ onSwitch, original, edited }: { onSwitch: () => void; original: number; edited: number }) {
  return (
    <div className="editor-mobile-playback" role="group" aria-label={editorStrings.dock.playback}>
      <EditorPlayButton onSwitch={onSwitch} />
      <EditorClock />
      <span className="editor-mobile-duration">/ {formatClock(original)}</span>
      {Math.round(original) !== Math.round(edited) ? <Durations original={original} edited={edited} /> : null}
    </div>
  );
}

/**
 * The selected effect's one setting, right after the tools (next to what you just used): a zoom's depth and a
 * speed-up's rate as a trigger and menu, a caption's text as an inline field. Nothing for other selections.
 */
export function EffectControls({
  edits,
  selection,
  change,
  mobile = false,
}: {
  mobile?: boolean;
  edits: ReplayEdits;
  selection: Selection;
  change: Change;
}) {
  if (!selection || selection.kind === 'range' || selection.kind === 'trim' || selection.kind === 'cut' || selection.kind === 'highlight')
    return null;
  const region = effectList(edits, selection.kind).find((item) => item.id === selection.id);
  if (!region) return null;
  const { kind, id } = selection;
  if (kind === 'caption' && 'text' in region) {
    if (mobile)
      return <MobileCaptionField key={id} text={region.text} onChange={(text) => change(updateEffect(edits, kind, id, { text }), selection)} />;
    return (
      <>
        <span className="editor-bar-divider editor-setting-divider" aria-hidden="true" />
        <input
          key={id}
          className="editor-caption-field"
          defaultValue={region.text}
          maxLength={160}
          aria-label={strings.captionText}
          data-testid="caption-text"
          onChange={(event) => {
            const text = event.target.value;
            if (text.trim()) change(updateEffect(edits, kind, id, { text }), selection);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') (event.target as HTMLInputElement).blur();
          }}
        />
      </>
    );
  }
  const options =
    kind === 'zoom'
      ? ZOOM_SCALES.map((value) => ({ value, label: strings.zoomOption(value) }))
      : kind === 'speed'
        ? SPEED_RATES.map((value) => ({ value, label: strings.speedOption(value) }))
        : [];
  if (!options.length) return null;
  const field = kind === 'zoom' ? 'scale' : 'rate';
  const current = (region as unknown as Record<string, number>)[field]!;
  return (
    <>
      <span className="editor-bar-divider editor-setting-divider" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-effect-trigger" data-testid={`${kind}-setting`} />}>
          {kind === 'zoom' ? strings.zoom(current) : strings.speed(current)}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className={mobile ? 'editor-mobile-effect-menu w-auto min-w-36' : 'w-auto min-w-36'}>
          <DropdownMenuRadioGroup
            value={String(current)}
            onValueChange={(value) => change(updateEffect(edits, kind, id, { [field]: Number(value) }), selection)}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={String(option.value)}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Keeps an unfinished empty draft local; undo/redo still replace the visible saved text. */
function MobileCaptionField({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState({ saved: text, value: text });
  if (draft.saved !== text) setDraft({ saved: text, value: text });
  return (
    <textarea
      id="mobile-caption-text"
      className="editor-caption-field"
      rows={3}
      value={draft.saved === text ? draft.value : text}
      maxLength={160}
      aria-label={strings.captionText}
      data-testid="caption-text"
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft({ saved: text, value });
        if (value.trim()) onChange(value);
      }}
      onBlur={() => {
        if (!draft.value.trim()) setDraft({ saved: text, value: text });
      }}
    />
  );
}

function HighlightTimeInput({ label, value, onChange, max }: { label: string; value: number; onChange: (time: number) => void; max: number }) {
  return (
    <label className="editor-highlight-time">
      <span>{label} (s)</span>
      <input
        type="number"
        min="0"
        max={(max / 1000).toFixed(1)}
        step="0.1"
        value={(value / 1000).toFixed(1)}
        aria-label={strings.seconds(label)}
        onChange={(event) => {
          const seconds = event.currentTarget.valueAsNumber;
          if (Number.isFinite(seconds)) onChange(Math.round(seconds * 1000));
        }}
      />
    </label>
  );
}

export function HighlightControls({
  edits,
  selection,
  duration,
  change,
  afterRemove,
}: {
  afterRemove?: () => void;
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: Change;
}) {
  if (selection?.kind !== 'highlight') return null;
  const highlight = edits.highlights?.find((item) => item.id === selection.id);
  if (!highlight) return null;
  const update = (patch: Parameters<typeof updateHighlight>[2]) => change(updateHighlight(edits, highlight.id, patch, duration), selection);
  return (
    <div className="editor-highlight-controls" role="group" aria-label={strings.selectedHighlight}>
      <span className="editor-bar-divider editor-setting-divider" aria-hidden="true" />
      <label className="editor-highlight-label">
        <span>{strings.label}</span>
        <input
          key={highlight.id}
          type="text"
          maxLength={120}
          value={highlight.label ?? ''}
          aria-label={strings.labelAria}
          placeholder={strings.labelPlaceholder}
          onChange={(event) => update({ label: event.currentTarget.value })}
        />
      </label>
      {highlight.kind === 'point' ? (
        <HighlightTimeInput label={strings.time} value={highlight.at} onChange={(at) => update({ kind: 'point', at })} max={duration} />
      ) : (
        <>
          <HighlightTimeInput
            label={strings.from}
            value={highlight.from}
            onChange={(from) => update({ kind: 'period', from })}
            max={Math.max(0, highlight.to - 100)}
          />
          <HighlightTimeInput label={strings.to} value={highlight.to} onChange={(to) => update({ kind: 'period', to })} max={duration} />
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          change(removeHighlight(edits, highlight.id));
          afterRemove?.();
        }}
        data-testid="remove-highlight"
      >
        {strings.remove}
      </Button>
    </div>
  );
}

/** The dock's standing hint for what is selected (a passing note replaces it for a moment). */
export function hintFor(selection: Selection, suggesting: boolean, empty: boolean) {
  const hint = editorStrings.hint;
  if (suggesting) return null;
  switch (selection?.kind) {
    case 'range':
      return hint.range(selection.to - selection.from);
    case 'cut':
    case 'highlight':
    case 'zoom':
    case 'speed':
    case 'blur':
    case 'caption':
    case 'trim':
      return hint[selection.kind];
    default:
      return empty ? hint.empty : hint.idle;
  }
}
