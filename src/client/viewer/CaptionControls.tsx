import { useId } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { IconButton, SwitchIconButton } from '@/components/icon-button.tsx';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { useFullscreenPopover } from '../hooks/use-fullscreen-popover.ts';
import { shortcutLabel } from '../shortcuts.ts';
import { useViewer } from './context.ts';

/** The quick caption toggle and its display preferences stay together on every player layout. */
export function CaptionControls() {
  const { captions, switchCaptions, captionNumbers, setCaptionNumbers } = useViewer();
  const { open, setOpen, portalContainer } = useFullscreenPopover();
  const numbersId = useId();
  return (
    <div className="flex items-center [grid-area:captions]">
      <SwitchIconButton
        className="captions-switch h-7 min-w-7 px-0 aria-pressed:ring-0 aria-pressed:bg-transparent aria-pressed:text-[var(--accent)]"
        label={captions ? 'Hide step captions' : 'Show step captions'}
        shortcut={shortcutLabel('switch-captions')}
        pressed={captions}
        onPressedChange={switchCaptions}
        data-testid="captions-switch"
      >
        <span className="captions-chip" aria-hidden="true">
          <AnimatedIcon name="captions" />
        </span>
      </SwitchIconButton>
      {setCaptionNumbers ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <IconButton label="Caption settings" className="h-7 min-w-6 px-0">
                <AnimatedIcon name="chevron-down" />
              </IconButton>
            }
          />
          <PopoverContent
            side="top"
            align="end"
            portalContainer={portalContainer}
            className="w-56 gap-3 p-3"
            aria-label="Caption settings"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
          >
            <PopoverTitle className="m-0 text-xs">Step captions</PopoverTitle>
            <div className="flex items-center justify-between gap-3">
              <label id={`${numbersId}-label`} htmlFor={numbersId}>
                Show step numbers
              </label>
              <Switch
                id={numbersId}
                nativeButton
                render={<button type="button" />}
                aria-labelledby={`${numbersId}-label`}
                checked={captionNumbers === true}
                disabled={!captions}
                onCheckedChange={setCaptionNumbers}
              />
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
