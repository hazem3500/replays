import { useState } from 'react';

import { RadioCard, RadioGroup } from '@/components/ui/radio-group.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { BLUR_STYLES, type BlurStyle, MAX_CAPTION } from '../../shared/effects.ts';
import { SpeedChoice, ZoomLevel } from './EffectSettings.tsx';
import { InspectorSection } from './InspectorParts.tsx';
import { type ChangeEdits, effectList, type EffectKind, type Selection, updateEffect, updateHighlight } from './state.ts';
import { TimingSection } from './TimingFields.tsx';

type EffectSelection = { kind: EffectKind; id: string };

const EFFECT_KINDS: readonly string[] = ['zoom', 'speed', 'blur', 'caption'];
const isEffectSelection = (selection: Selection): selection is EffectSelection => !!selection && EFFECT_KINDS.includes(selection.kind);

/** The selected effect's own setting: zoom level, speed, how a blur hides, or a caption's text. */
export function EffectControls({ edits, selection, change }: { edits: ReplayEdits; selection: Selection; change: ChangeEdits }) {
  if (!isEffectSelection(selection)) return null;
  const { kind, id } = selection;
  const region = effectList(edits, kind).find((item) => item.id === id);
  if (!region) return null;
  const update = (patch: Record<string, unknown>, merge = false) => change(updateEffect(edits, kind, id, patch), selection, merge);
  if ('text' in region) return <CaptionField key={id} text={region.text} onChange={(text) => update({ text })} />;
  if ('scale' in region) return <ZoomLevel value={region.scale} onChange={(scale, merge) => update({ scale }, merge)} />;
  if ('rate' in region) return <SpeedChoice value={region.rate} length={region.to - region.from} onChange={(rate) => update({ rate })} />;
  const style = 'style' in region && region.style === 'redact' ? 'redact' : 'blur';
  return <BlurStyleChoice current={style} onPick={(next) => update({ style: next })} />;
}

const BLUR_STYLE_COPY: Record<BlurStyle, { label: string; hint: string }> = {
  blur: { label: 'Blur', hint: 'A strong blur with soft edges' },
  redact: { label: 'Redact', hint: 'A solid block that hides shapes too' },
};

/** How the box hides what is under it, with the choice's effect spelled out under the control. */
function BlurStyleChoice({ current, onPick }: { current: BlurStyle; onPick: (style: BlurStyle) => void }) {
  return (
    <InspectorSection label="Hide with" labelId="inspector-blur-label" hint={BLUR_STYLE_COPY[current].hint} hintId="inspector-blur-hint">
      <RadioGroup
        className="ui-segmented"
        value={current}
        aria-labelledby="inspector-blur-label"
        aria-describedby="inspector-blur-hint"
        data-testid="blur-setting"
        onValueChange={(value) => {
          if (BLUR_STYLES.includes(value)) onPick(value);
        }}
      >
        {BLUR_STYLES.map((style) => (
          <RadioCard key={style} value={style} className="ui-segment">
            {BLUR_STYLE_COPY[style].label}
          </RadioCard>
        ))}
      </RadioGroup>
    </InspectorSection>
  );
}

/** Keep an unfinished empty draft local; undo/redo still replace the visible saved text. */
function CaptionField({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState({ saved: text, value: text });
  if (draft.saved !== text) setDraft({ saved: text, value: text });
  const value = draft.saved === text ? draft.value : text;
  return (
    <InspectorSection label={<label htmlFor="selection-caption-text">Text</label>} value={`${value.length} of ${MAX_CAPTION}`}>
      <textarea
        id="selection-caption-text"
        className="inspector-textarea"
        rows={3}
        value={value}
        maxLength={MAX_CAPTION}
        aria-label="Caption text"
        data-testid="caption-text"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft({ saved: text, value: next });
          if (next.trim()) onChange(next);
        }}
        onBlur={() => {
          if (!draft.value.trim()) setDraft({ saved: text, value: text });
        }}
      />
    </InspectorSection>
  );
}

/** A highlight's label and when it is: the same sections as every other object; removing it is the footer's job. */
export function HighlightControls({
  edits,
  selection,
  duration,
  change,
}: {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: ChangeEdits;
}) {
  if (selection?.kind !== 'highlight') return null;
  const highlight = edits.highlights?.find((item) => item.id === selection.id);
  if (!highlight) return null;
  const update = (patch: Parameters<typeof updateHighlight>[2]) => change(updateHighlight(edits, highlight.id, patch, duration), selection);
  const fields =
    highlight.kind === 'point'
      ? [{ label: 'Time', value: highlight.at, max: duration, onChange: (at: number) => update({ kind: 'point', at }) }]
      : [
          {
            label: 'From',
            value: highlight.from,
            max: Math.max(0, highlight.to - 100),
            onChange: (from: number) => update({ kind: 'period', from }),
          },
          { label: 'To', value: highlight.to, max: duration, onChange: (to: number) => update({ kind: 'period', to }) },
        ];
  return (
    <>
      <InspectorSection label={<label htmlFor="inspector-highlight-label">Label</label>}>
        <input
          id="inspector-highlight-label"
          key={highlight.id}
          className="inspector-input"
          type="text"
          maxLength={120}
          value={highlight.label ?? ''}
          aria-label="Highlight label"
          placeholder="Add a label"
          onChange={(event) => update({ label: event.currentTarget.value })}
        />
      </InspectorSection>
      <TimingSection
        fields={fields}
        span={highlight.kind === 'period' ? highlight.to - highlight.from : undefined}
        hint="Or drag it on the timeline"
      />
    </>
  );
}
