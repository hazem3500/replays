import { useRef, useState } from 'react';
import { RotateCcwIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from '@/components/ui/slider.tsx';
import { useFocusWhen } from '../hooks/use-focus-when.ts';
import { normalizeCursor, type ReplayCursorSettings } from '../../shared/cursor.ts';
import { CursorAppearancePicker } from './CursorAppearancePicker.tsx';
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
  const heading = useRef<HTMLHeadingElement>(null);
  const savedSize = settings?.size ?? 1;
  const [draft, setDraft] = useState({ saved: savedSize, value: savedSize });
  // why: undo, redo and reset replace the saved size; discard a stale drag before painting.
  if (draft.saved !== savedSize) setDraft({ saved: savedSize, value: savedSize });
  const size = draft.saved === savedSize ? draft.value : savedSize;
  useFocusWhen(heading, !embedded);
  const visible = settings?.visible !== false;
  const update = (patch: ReplayCursorSettings) => onChange(normalizeCursor({ ...settings, ...patch }));
  const reset = (
    <Button variant="ghost" size="sm" disabled={!normalizeCursor(settings)} onClick={() => onChange(undefined)}>
      <RotateCcwIcon aria-hidden="true" />
      Reset
    </Button>
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- why: the role is dialog or group, which the lint cannot read through the expression; the handler delegates Escape and shields contained controls from global editor shortcuts.
    <div
      role={embedded ? 'group' : 'dialog'}
      aria-modal={embedded ? undefined : false}
      className="cursor-inspector"
      id="cursor-inspector"
      aria-labelledby="cursor-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !embedded) {
          event.preventDefault();
          onClose();
        } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          // why: the inspector's switches, radios and slider own their keyboard interaction.
          event.stopPropagation();
        }
      }}
    >
      <header className="cursor-inspector-header">
        <div className="cursor-inspector-title">
          <h2 id="cursor-heading" ref={heading} tabIndex={-1}>
            Cursor
          </h2>
          <p>Applies to the whole replay</p>
        </div>
        {embedded ? (
          reset
        ) : (
          <IconButton label="Close cursor options" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </IconButton>
        )}
      </header>
      <div className="cursor-row">
        <label htmlFor="cursor-visible" className="cursor-row-label">
          Show cursor
        </label>
        <Switch id="cursor-visible" checked={visible} onCheckedChange={(checked) => update({ visible: checked })} />
      </div>
      <fieldset disabled={!visible} className="cursor-options">
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
          <CursorMotionPicker value={settings?.motion ?? 'signature_arc'} disabled={!visible} onChange={(motion) => update({ motion })} />
        </section>
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
            disabled={!visible}
            onValueChange={(value) => setDraft({ saved: savedSize, value })}
            onValueCommitted={(value) => update({ size: Math.round(value * 100) / 100 })}
          >
            <SliderControl>
              <SliderTrack>
                <SliderIndicator />
                <SliderThumb
                  aria-labelledby="cursor-size-label"
                  getAriaValueText={(value) => `${Math.round(Number(value) * 100)} percent`}
                />
              </SliderTrack>
            </SliderControl>
          </Slider>
          <div className="cursor-size-scale" aria-hidden="true">
            <span>50%</span>
            <span>200%</span>
          </div>
        </section>
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
          <div className="cursor-row">
            <label htmlFor="cursor-clicks" className="cursor-row-label">
              Click feedback<small>A subtle press animation</small>
            </label>
            <Switch
              id="cursor-clicks"
              disabled={!visible}
              checked={settings?.clickFeedback !== false}
              onCheckedChange={(checked) => update({ clickFeedback: checked })}
            />
          </div>
        </section>
      </fieldset>
      {embedded ? null : (
        <footer className="cursor-inspector-footer">
          <span>Applies to the whole replay</span>
          {reset}
        </footer>
      )}
    </div>
  );
}
