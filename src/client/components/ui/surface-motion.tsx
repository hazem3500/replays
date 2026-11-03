import type { ComponentProps } from 'react';

import { useTooltipMotion } from '../../hooks/use-tooltip-motion.ts';
import { useTabIndicatorMotion } from '../../hooks/use-tab-indicator-motion.ts';
import { useSurfaceMotion, type SurfaceMotionKind } from '../../hooks/use-surface-motion.ts';

/** Base UI passes its merged DOM props and open state without relinquishing focus, dismissal or presence. */
export function SurfaceMotion({
  open,
  kind,
  instant = false,
  ref,
  ...props
}: ComponentProps<'div'> & {
  open: boolean;
  kind: SurfaceMotionKind;
  instant?: boolean;
}) {
  const element = useSurfaceMotion(open, kind, ref, instant);
  return <div {...props} ref={element} />;
}

/** Geometry remains owned by Base UI and is animated without replacing its indicator element. */
export function TabIndicatorMotion({ ref, ...props }: ComponentProps<'span'>) {
  const element = useTabIndicatorMotion(ref);
  return <span {...props} ref={element} />;
}

/** The tooltip positioner stays a Base UI node so collision handling and accessibility remain unchanged. */
export function TooltipPositionMotion({ ref, ...props }: ComponentProps<'div'>) {
  const element = useTooltipMotion(ref);
  return <div {...props} ref={element} />;
}
