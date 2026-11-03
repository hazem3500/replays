import './animated-icon.css';

import type { Ref, SVGProps } from 'react';

import { cn } from '@/lib/utils.ts';

import { ANIMATED_ICONS, type AnimatedIconName, type IconPart, type PartMotion } from './animated-icon-data.ts';
import { useAnimatedIcon } from '../hooks/use-animated-icon.ts';

export type { AnimatedIconName } from './animated-icon-data.ts';
export { ANIMATED_ICON_NAMES } from './animated-icon-data.ts';

export interface AnimatedIconHandle {
  /** Plays the gesture once (no-op under reduced motion, during key repeat, or while already playing). */
  play(): boolean;
}

/**
 * Elements whose hover / keyboard navigation plays a `trigger="hover"` icon inside them. The nearest one wins; add
 * `data-icon-host` to any other element (a list row, a card) to make it the host.
 */
export { ICON_HOST_SELECTOR } from '../hooks/use-animated-icon.ts';

export interface AnimatedIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'name'> {
  name: AnimatedIconName;
  /**
   * hover (default): plays when the nearest host (button, link, menu item, `[data-icon-host]`) is hovered by a
   * mouse, tapped by a finger, or is reached with the keyboard. state: plays when `play` changes (not on mount; rapid changes coalesce).
   * none: only `ref.play()`.
   */
  trigger?: 'hover' | 'state' | 'none';
  /** For `trigger="state"`: plays once each time this changes to a new value; changes to false / null / undefined rest. */
  play?: unknown;
  /** A `trigger="state"` icon that also plays on its host's hover / keyboard navigation (the theme switch's sun and moon). */
  hover?: boolean;
  /** Width and height in px, like lucide's `size` (24). Tailwind size classes / CSS still win. */
  size?: number | string;
  strokeWidth?: number | string;
  ref?: Ref<AnimatedIconHandle>;
}

/**
 * A lucide icon that can play a short one-shot Motion gesture. At rest it is the
 * same SVG lucide-react renders (`lucide lucide-<name>` classes, 24 viewBox, currentColor, stroke 2), so it
 * drops into existing call sites and their `[&_svg]:size-4` / `.step-kind` sizing. Under
 * prefers-reduced-motion it never moves.
 */
export function AnimatedIcon({
  name,
  trigger = 'hover',
  play,
  hover = false,
  size = 24,
  strokeWidth = 2,
  className,
  ref,
  ...props
}: AnimatedIconProps) {
  const definition = ANIMATED_ICONS[name];
  const svgRef = useAnimatedIcon(definition, { trigger, play, hover, ref });

  const parts = definition.parts.map((part, index) => renderPart(part, index));
  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
      data-trigger={trigger}
      className={cn('lucide', `lucide-${name}`, 'animated-icon', className)}
      {...props}
    >
      {definition.motion ? (
        <g data-icon-group="" {...motionProps(definition.motion)}>
          {parts}
        </g>
      ) : (
        parts
      )}
    </svg>
  );
}

function renderPart({ el: Element, attrs, motion }: IconPart, index: number) {
  const draw = motion?.kind === 'draw' ? { pathLength: 1 } : {};
  return <Element key={index} data-icon-part={index} {...attrs} {...draw} {...(motion ? motionProps(motion) : {})} />;
}

/** Static SVG geometry stays independent of the gesture timeline. */
function motionProps(motion: PartMotion) {
  return { 'data-motion': motion.kind, style: { transformOrigin: motion.origin ?? 'center' } };
}
