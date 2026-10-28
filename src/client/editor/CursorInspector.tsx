import { useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from '@/components/ui/slider.tsx';
import { normalizeCursor, type ReplayCursorSettings } from '../../shared/cursor.ts';
import { CURSOR_CANVAS, CURSOR_PATH } from '../cursor-motion.ts';

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
  // Undo, redo and reset replace the saved size; discard a stale drag before painting.
  if (draft.saved !== savedSize) setDraft({ saved: savedSize, value: savedSize });
  const size = draft.saved === savedSize ? draft.value : savedSize;
  useEffect(() => {
    if (!embedded) heading.current?.focus();
  }, [embedded]);
  const visible = settings?.visible !== false;
  const update = (patch: ReplayCursorSettings) => onChange(normalizeCursor({ ...settings, ...patch }));

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
          // The inspector's switches and slider own their keyboard interaction.
          event.stopPropagation();
        }
      }}
    >
      <header className="cursor-inspector-header">
        <h2 id="cursor-heading" ref={heading} tabIndex={-1}>
          Cursor
        </h2>
        {embedded ? null : (
          <IconButton label="Close cursor options" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </IconButton>
        )}
      </header>
      <div className="cursor-option-row">
        <label htmlFor="cursor-visible">Show cursor</label>
        <Switch id="cursor-visible" checked={visible} onCheckedChange={(checked) => update({ visible: checked })} />
      </div>
      <fieldset disabled={!visible} className="cursor-options">
        <legend className="sr-only">Cursor appearance and behavior</legend>
        <div className="cursor-style-preview">
          <svg viewBox={`0 0 ${CURSOR_CANVAS} ${CURSOR_CANVAS}`} aria-hidden="true">
            <path d={CURSOR_PATH} />
          </svg>
          <span>
            CUA arrow<small>Smooth motion</small>
          </span>
        </div>
        <div className="cursor-option-row">
          <span id="cursor-size-label">Size</span>
          <output>{Math.round(size * 100)}%</output>
        </div>
        <Slider
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
            </SliderTrack>
            <SliderThumb aria-labelledby="cursor-size-label" getAriaValueText={(value) => `${Math.round(Number(value) * 100)} percent`} />
          </SliderControl>
        </Slider>
        <div className="cursor-option-row cursor-idle-option">
          <label htmlFor="cursor-idle">
            Hide when idle<small>Fade after 1.5 seconds</small>
          </label>
          <Switch
            id="cursor-idle"
            disabled={!visible}
            checked={settings?.hideWhenIdle !== false}
            onCheckedChange={(checked) => update({ hideWhenIdle: checked })}
          />
        </div>
        <div className="cursor-option-row">
          <label htmlFor="cursor-clicks">
            Click feedback<small>A subtle press animation</small>
          </label>
          <Switch
            id="cursor-clicks"
            disabled={!visible}
            checked={settings?.clickFeedback !== false}
            onCheckedChange={(checked) => update({ clickFeedback: checked })}
          />
        </div>
      </fieldset>
      <footer className="cursor-inspector-footer">
        <span>Applies to the whole replay</span>
        <Button variant="ghost" size="sm" disabled={!normalizeCursor(settings)} onClick={() => onChange(undefined)}>
          Reset
        </Button>
      </footer>
    </div>
  );
}
