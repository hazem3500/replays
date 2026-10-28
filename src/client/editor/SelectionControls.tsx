import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { SPEED_RATES, ZOOM_SCALES } from '../../shared/effects.ts';
import { effectList, removeHighlight, type Selection, updateEffect, updateHighlight } from './state.ts';

export function EffectControls({
  edits,
  selection,
  change,
  mobile = false,
}: {
  mobile?: boolean;
  edits: ReplayEdits;
  selection: Selection;
  change: (edits: ReplayEdits, select?: Selection) => void;
}) {
  if (!selection || selection.kind === 'range' || selection.kind === 'trim' || selection.kind === 'cut' || selection.kind === 'highlight')
    return null;
  const region = effectList(edits, selection.kind).find((item) => item.id === selection.id);
  if (!region) return null;
  const { kind, id } = selection;
  if (kind === 'caption' && 'text' in region) {
    const onText = (text: string) => change(updateEffect(edits, kind, id, { text }), selection);
    return <CaptionField key={id} id="selection-caption-text" text={region.text} onChange={onText} />;
  }
  if (kind !== 'zoom' && kind !== 'speed') return null;
  const field = kind === 'zoom' ? 'scale' : 'rate';
  const current = (region as unknown as Record<string, number>)[field]!;
  const onPick = (value: number) => change(updateEffect(edits, kind, id, { [field]: value }), selection);
  return mobile ? (
    <EffectSettingMenu kind={kind} current={current} onPick={onPick} />
  ) : (
    <EffectSettingChoice kind={kind} current={current} onPick={onPick} />
  );
}

function settingOptions(kind: 'zoom' | 'speed') {
  return kind === 'zoom'
    ? ZOOM_SCALES.map((value) => ({ value, label: `${value}× zoom` }))
    : SPEED_RATES.map((value) => ({ value, label: `${value}× faster` }));
}

/** The phone's compact setting: a menu from the property panel. */
function EffectSettingMenu({ kind, current, onPick }: { kind: 'zoom' | 'speed'; current: number; onPick: (value: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-effect-trigger" data-testid={`${kind}-setting`} />}>
        {kind === 'zoom' ? `Zoom ${current}×` : `Speed ${current}×`}
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="editor-mobile-effect-menu w-auto min-w-36">
        <DropdownMenuRadioGroup value={String(current)} onValueChange={(value) => onPick(Number(value))}>
          {settingOptions(kind).map((option) => (
            <DropdownMenuRadioItem key={option.value} value={String(option.value)}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The inspector's setting: every choice visible at once, the current one pressed. */
function EffectSettingChoice({ kind, current, onPick }: { kind: 'zoom' | 'speed'; current: number; onPick: (value: number) => void }) {
  const label = kind === 'zoom' ? 'Zoom level' : 'Speed';
  return (
    <div className="inspector-field">
      <span className="inspector-field-label" id={`inspector-${kind}-label`}>
        {label}
      </span>
      <RadioGroup
        className="ui-segmented"
        value={current}
        aria-labelledby={`inspector-${kind}-label`}
        data-testid={`${kind}-setting`}
        onValueChange={(value) => onPick(Number(value))}
      >
        {settingOptions(kind).map((option) => (
          <RadioCard key={option.value} value={option.value} className="ui-segment" aria-label={option.label}>
            {option.value}×
          </RadioCard>
        ))}
      </RadioGroup>
    </div>
  );
}

/** Keep an unfinished empty draft local; undo/redo still replace the visible saved text. */
function CaptionField({ id, text, onChange }: { id: string; text: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState({ saved: text, value: text });
  if (draft.saved !== text) setDraft({ saved: text, value: text });
  return (
    <textarea
      id={id}
      className="editor-caption-field"
      rows={3}
      value={draft.saved === text ? draft.value : text}
      maxLength={160}
      aria-label="Caption text"
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

function HighlightTimeInput({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (time: number) => void;
  max: number;
}) {
  return (
    <label className="editor-highlight-time">
      <span>{label} (s)</span>
      <input
        type="number"
        min="0"
        max={(max / 1000).toFixed(1)}
        step="0.1"
        value={(value / 1000).toFixed(1)}
        aria-label={`${label} in seconds`}
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
  change: (edits: ReplayEdits, select?: Selection) => void;
}) {
  if (selection?.kind !== 'highlight') return null;
  const highlight = edits.highlights?.find((item) => item.id === selection.id);
  if (!highlight) return null;
  const update = (patch: Parameters<typeof updateHighlight>[2]) => change(updateHighlight(edits, highlight.id, patch, duration), selection);
  return (
    <div className="editor-highlight-controls" role="group" aria-label="Selected highlight">
      <label className="editor-highlight-label">
        <span>Label</span>
        <input
          key={highlight.id}
          type="text"
          maxLength={120}
          value={highlight.label ?? ''}
          aria-label="Highlight label"
          placeholder="Add a label"
          onChange={(event) => update({ label: event.currentTarget.value })}
        />
      </label>
      {highlight.kind === 'point' ? (
        <HighlightTimeInput label="Time" value={highlight.at} onChange={(at) => update({ kind: 'point', at })} max={duration} />
      ) : (
        <>
          <HighlightTimeInput
            label="From"
            value={highlight.from}
            onChange={(from) => update({ kind: 'period', from })}
            max={Math.max(0, highlight.to - 100)}
          />
          <HighlightTimeInput label="To" value={highlight.to} onChange={(to) => update({ kind: 'period', to })} max={duration} />
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
        Remove
      </Button>
    </div>
  );
}
