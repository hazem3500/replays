import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { createContext, type ReactNode, useContext, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils.ts';

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';
type TooltipAlign = 'start' | 'center' | 'end';

/** What a shared (morphing) tooltip trigger hands the one popup: its content and placement. */
export interface SharedTooltipPayload {
  content: ReactNode;
  side: TooltipSide;
  align: TooltipAlign;
}

export type SharedTooltipHandle = TooltipPrimitive.Handle<SharedTooltipPayload>;

const SharedTooltipContext = createContext<SharedTooltipHandle | null>(null);

/** Triggers further apart than this (centre to centre) swap the tooltip without gliding across the screen. */
const MORPH_MAX_DISTANCE = 240;
/** How far two triggers' centres may drift off a shared row or column and still count as one strip. */
const MORPH_AXIS_TOLERANCE = 4;

/**
 * Neighbours sit in one strip, a toolbar row or a list column, close together. A hop between strips (a list
 * row to a toolbar button, one toolbar to another) jumps: sliding the tooltip diagonally across content
 * would read as motion for its own sake.
 */
function areNeighbours(previous: Element, next: Element) {
  const a = previous.getBoundingClientRect();
  const b = next.getBoundingClientRect();
  const dx = Math.abs(a.left + a.width / 2 - (b.left + b.width / 2));
  const dy = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
  return Math.min(dx, dy) <= MORPH_AXIS_TOLERANCE && Math.hypot(dx, dy) <= MORPH_MAX_DISTANCE;
}

/**
 * The provider also owns one shared tooltip: every `Hint` trigger under it attaches to the same popup
 * through a Base UI handle, so moving between neighbouring triggers morphs that popup (position, size,
 * label crossfade; `.tip-morph-*` in tailwind.css) instead of swapping two popups. A hop to a trigger that is
 * not a neighbour (another strip, a fast flick across the page) jumps instead of sliding the tooltip over it.
 */
function TooltipProvider({ delay = 0, children, ...props }: TooltipPrimitive.Provider.Props) {
  const [handle] = useState(() => TooltipPrimitive.createHandle<SharedTooltipPayload>());
  const [glide, setGlide] = useState(true);
  const lastTrigger = useRef<Element | null>(null);
  return (
    <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props}>
      <SharedTooltipContext.Provider value={handle}>
        {children}
        <TooltipPrimitive.Root
          handle={handle}
          onOpenChange={(open, { trigger }) => {
            // A hover hop can report a close before the next open while the popup is still showing, so the
            // last trigger is kept across closes; the first open of a session never morphs anyway.
            if (!open || !trigger) return;
            const previous = lastTrigger.current;
            lastTrigger.current = trigger;
            setGlide(!previous || previous === trigger || areNeighbours(previous, trigger));
          }}
        >
          {({ payload }) =>
            payload ? (
              <TooltipContent side={payload.side} align={payload.align} morph={glide}>
                {payload.content}
              </TooltipContent>
            ) : null
          }
        </TooltipPrimitive.Root>
      </SharedTooltipContext.Provider>
    </TooltipPrimitive.Provider>
  );
}

/**
 * Whether the primary pointer can hover. Phones cannot: a tooltip there only ever opens by accident (keyboard
 * returning to a trigger after a menu closes, a synthetic hover after a tap) and then sticks, so hints stay
 * closed. Anything a hint says must also be reachable without it (an accessible name, a menu, a sheet).
 */
const HOVER_QUERY = '(hover: hover)';
function subscribeHover(onChange: () => void) {
  const list = matchMedia(HOVER_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}
function useCanHover() {
  return useSyncExternalStore(
    subscribeHover,
    () => matchMedia(HOVER_QUERY).matches,
    () => true,
  );
}

/** The provider's shared tooltip handle, or null outside a provider. */
function useSharedTooltipHandle() {
  return useContext(SharedTooltipContext);
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger<Payload = unknown>({ ...props }: TooltipPrimitive.Trigger.Props<Payload>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  alignOffset = 0,
  children,
  morph = true,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'> & {
    /** Whether a switch to another trigger of the same tooltip glides (true) or jumps (false). */
    morph?: boolean;
  }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="tip-morph-positioner isolate z-50"
        data-tip-jump={morph ? undefined : ''}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'motion-tip tip-morph-popup z-50 max-w-xs origin-(--transform-origin) rounded-md bg-[var(--surface-raised)] text-xs text-foreground shadow-[var(--shadow-pop)] ring-1 ring-[var(--line-strong)] **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm',
            className,
          )}
          {...props}
        >
          {/* The viewport keeps the outgoing label (data-previous) over the incoming one (data-current) while the
              popup morphs between triggers; each layer carries the padding so both lay out like the popup did. */}
          <TooltipPrimitive.Viewport className="tip-morph-viewport relative size-full overflow-clip rounded-[inherit] *:flex *:w-max *:max-w-xs *:items-center *:gap-1.5 *:px-2 *:py-1 *:has-data-[slot=kbd]:pr-1.5">
            {children}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, useCanHover, useSharedTooltipHandle };
