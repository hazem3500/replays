import { useOpacityMotion } from '../hooks/use-opacity-motion.ts';
import { useRef, useState } from 'react';
import { RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from '@/components/ui/slider.tsx';
import { useFocusWhen } from '../hooks/use-focus-when.ts';
import { useCursorInspectorKeys } from '../hooks/use-cursor-inspector-keys.ts';
import { normalizeCursor, type ReplayCursorSettings } from '../../shared/cursor.ts';
import { CursorAppearancePicker } from './CursorAppearancePicker.tsx';
import { CursorClickPicker } from './CursorClickPicker.tsx';
import { CursorMotionPicker } from './CursorMotionPicker.tsx';

const percent = (size: number) => `${Math.round(size * 100)}%`;

export function CursorInspector({
  settings,
  onChange,
  onClose,
  embedded = false,
}: {
  settings: ReplayCursorSettings | undefined;
  onChange: (settings: ReplayCursorSettings | undefined) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const heading = useRef<HTMLElement>(null);
  const inspector = useRef<HTMLDetailsElement>(null);
  useCursorInspectorKeys(inspector, embedded, onClose);
  const savedSize = settings?.size ?? 1;
  const [draft, setDraft] = useState({ saved: savedSize, value: savedSize });
  // why: undo, redo and reset replace the saved size; discard a stale drag before painting.
  if (draft.saved !== savedSize) setDraft({ saved: savedSize, value: savedSize });
  const size = draft.saved === savedSize ? draft.value : savedSize;
  useFocusWhen(heading, !embedded);
  const visible = settings?.visible !== false;
  const options = useRef<HTMLFieldSetElement>(null);
  useOpacityMotion(options, visible ? 1 : 0.45);
  const update = (patch: ReplayCursorSettings) => onChange(normalizeCursor({ ...settings, ...patch }));
  const reset = (
    <Button variant="ghost" size="sm" disabled={!normalizeCursor(settings)} onClick={() => onChange(undefined)}>
      <RotateCcwIcon aria-hidden="true" />
      Reset
    </Button>
  );

  return (
    <details
      ref={inspector}
      role={embedded ? 'group' : 'dialog'}
      aria-modal={embedded ? undefined : false}
      className="cursor-inspector"
      id="cursor-inspector"
      aria-labelledby="cursor-heading"
    >
      <summary className="cursor-disclosure" id="cursor-heading" ref={heading}>
        Cursor
      </summary>
      <div className="cursor-row">
        <label htmlFor="cursor-visible" className="cursor-row-label">
          Show cursor
        </label>
        <Switch id="cursor-visible" checked={visible} onCheckedChange={(checked) => update({ visible: checked })} />
      </div>
      <fieldset ref={options} disabled={!visible} className="cursor-options">
        <legend className="sr-only">Cursor appearance and behavior</legend>
        <section className="cursor-section">
          <CursorAppearancePicker
            appearance={settings?.appearance ?? 'arrow'}
            color={settings?.color}
            disabled={!visible}
            onChange={(patch) => update(patch)}
          />
        </section>
        <section className="cursor-section">
          <CursorClickPicker settings={settings} disabled={!visible} onChange={update} />
        </section>
        <details className="cursor-advanced">
          <summary>Advanced</summary>
          <section className="cursor-section">
            <CursorMotionPicker value={settings?.motion ?? 'signature_arc'} disabled={!visible} onChange={(motion) => update({ motion })} />
          </section>
          <CursorSizeControl
            size={size}
            disabled={!visible}
            onChange={(value) => setDraft({ saved: savedSize, value })}
            onCommit={(value) => update({ size: Math.round(value * 100) / 100 })}
          />
          <section className="cursor-section">
            <div className="cursor-row">
              <label htmlFor="cursor-idle" className="cursor-row-label">
                Hide when idle<small>Fade after 1.5 seconds</small>
              </label>
              <Switch
                id="cursor-idle"
                disabled={!visible}
                checked={settings?.hideWhenIdle !== false}
                onCheckedChange={(checked) => update({ hideWhenIdle: checked })}
              />
            </div>
          </section>
        </details>
      </fieldset>
      <footer className="cursor-inspector-footer">{reset}</footer>
    </details>
  );
}

function CursorSizeControl({
  size,
  disabled,
  onChange,
  onCommit,
}: {
  size: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <section className="cursor-section">
      <div className="cursor-row cursor-row-compact">
        <span id="cursor-size-label" className="cursor-section-label">
          Size
        </span>
        <output className="cursor-value">{percent(size)}</output>
      </div>
      <Slider
        className="cursor-size-slider"
        value={size}
        min={0.5}
        max={2}
        step={0.05}
        disabled={disabled}
        onValueChange={onChange}
        onValueCommitted={onCommit}
      >
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-labelledby="cursor-size-label" getAriaValueText={(value) => `${Math.round(Number(value) * 100)} percent`} />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div className="cursor-size-scale" aria-hidden="true">
        <span>50%</span>
        <span>200%</span>
      </div>
    </section>
  );
}
