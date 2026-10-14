import { type ComponentProps, type ReactElement, type ReactNode, useId, useMemo } from 'react';

import { AnimatedText } from '@/components/animated-text.tsx';

import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Pressable } from '@/components/ui/pressable.tsx';
import {
  type SharedTooltipPayload,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useCanHover,
  useSharedTooltipHandle,
} from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/utils.ts';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

export interface HintProps {
  /** Tooltip text. */
  label: ReactNode;
  /** Keyboard shortcut rendered as a <Kbd> after the label. */
  shortcut?: string;
  side?: Side;
  align?: Align;
  /** The trigger: any element that forwards ref and props (Button, Switch, a menu trigger…). */
  children: ReactElement;
  /** Keeps the trigger but never opens (e.g. when the label is already visible). */
  disabled?: boolean;
}

/**
 * Tooltip for an existing control. Hover opens after the provider delay; once one hint is open,
 * neighbours take it over instantly: under a TooltipProvider every hint shares the provider's one
 * popup, which morphs (position, size, label crossfade) from trigger to trigger instead of blinking.
 */
export function Hint({ label, shortcut, side = 'top', align = 'center', children, disabled: disabledProp = false }: HintProps) {
  const handle = useSharedTooltipHandle();
  // Touch-only devices never show hints (see useCanHover); the trigger keeps working as is.
  const canHover = useCanHover();
  const disabled = disabledProp || !canHover;
  // A label that changes while its tooltip shows ("Play" → "Pause") morphs; keyed per trigger, so moving to another
  // trigger is the shared tooltip's own crossfade, not a morph.
  const trigger = useId();
  const payload = useMemo<SharedTooltipPayload>(
    () => ({
      content: (
        <>
          {typeof label === 'string' ? <AnimatedText key={trigger} text={label} /> : label}
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </>
      ),
      side,
      align,
    }),
    [label, shortcut, side, align, trigger],
  );
  if (handle) return <TooltipTrigger handle={handle} payload={payload} disabled={disabled} render={children} />;
  // Outside a provider (isolated renders), fall back to a tooltip of its own.
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} align={align}>
        {payload.content}
      </TooltipContent>
    </Tooltip>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'aria-label' | 'children'> {
  /** Accessible name and tooltip text. */
  label: string;
  /** Richer tooltip content (e.g. a muted second line); the accessible name stays `label`. */
  hint?: ReactNode;
  shortcut?: string;
  tooltipSide?: Side;
  tooltipAlign?: Align;
  children: ReactNode;
}

/** Ghost icon button (28 px) with a tooltip: the default form for secondary actions. */
export function IconButton({
  label,
  hint,
  shortcut,
  tooltipSide,
  tooltipAlign,
  className,
  variant = 'ghost',
  size = 'icon',
  children,
  ...props
}: IconButtonProps) {
  return (
    <Hint
      label={hint ?? label}
      {...(shortcut ? { shortcut } : {})}
      {...(tooltipSide ? { side: tooltipSide } : {})}
      {...(tooltipAlign ? { align: tooltipAlign } : {})}
    >
      <Button
        variant={variant}
        size={size}
        aria-label={label}
        className={cn('text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4', className)}
        {...props}
      >
        {children}
      </Button>
    </Hint>
  );
}

export interface SwitchIconButtonProps
  extends Omit<ComponentProps<typeof Pressable>, 'aria-label' | 'children' | 'pressed' | 'onPressedChange'> {
  label: string;
  shortcut?: string;
  tooltipSide?: Side;
  tooltipAlign?: Align;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
}

/** Icon switch with aria-pressed. "On" is accent-tinted ink with a faint ring, not a filled block. */
export function SwitchIconButton({
  label,
  shortcut,
  tooltipSide,
  tooltipAlign,
  pressed,
  onPressedChange,
  className,
  children,
  ...props
}: SwitchIconButtonProps) {
  return (
    <Hint
      label={label}
      {...(shortcut ? { shortcut } : {})}
      {...(tooltipSide ? { side: tooltipSide } : {})}
      {...(tooltipAlign ? { align: tooltipAlign } : {})}
    >
      <Pressable
        aria-label={label}
        pressed={pressed}
        onPressedChange={(next) => onPressedChange(next)}
        className={cn(
          'text-[var(--text-secondary)] [&_svg:not([class*=size-])]:size-4 aria-pressed:bg-transparent aria-pressed:text-primary aria-pressed:ring-1 aria-pressed:ring-primary/35 aria-pressed:hover:bg-muted',
          className,
        )}
        {...props}
      >
        {children}
      </Pressable>
    </Hint>
  );
}
