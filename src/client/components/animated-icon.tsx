import './animated-icon.css';

import { type CSSProperties, type Ref, type SVGProps, useEffect, useImperativeHandle, useRef } from 'react';

import { cn } from '@/lib/utils.ts';

import { ANIMATED_ICONS, type AnimatedIconName, type IconPart, type PartMotion } from './animated-icon-data.ts';
import { createIconPlayer, createKeyWatcher, type IconPlayer } from './animated-icon-player.ts';

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
export const ICON_HOST_SELECTOR =
  '[data-icon-host], button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], label';

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
 * A lucide icon that can play a short one-shot gesture (CSS only, 220–380 ms, ease-out). At rest it is the
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
  const svgRef = useRef<SVGSVGElement>(null);
  const playerRef = useRef<IconPlayer | null>(null);
  const keyWatcher = useRef<((next: unknown) => boolean) | null>(null);
  keyWatcher.current ??= createKeyWatcher(play);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const player = createIconPlayer(svg, definition.ms);
    playerRef.current = player;
    return () => {
      player.cancel();
      playerRef.current = null;
    };
  }, [definition]);

  useImperativeHandle(ref, () => ({ play: () => playerRef.current?.play() ?? false }), []);

  useEffect(() => {
    if (trigger !== 'state') return;
    if (keyWatcher.current?.(play)) playerRef.current?.play({ coalesce: true });
  }, [trigger, play]);

  useEffect(() => {
    if (trigger !== 'hover' && !(trigger === 'state' && hover)) return;
    const svg = svgRef.current;
    const host = svg?.parentElement?.closest(ICON_HOST_SELECTOR) ?? svg;
    if (!host) return;
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') playerRef.current?.play();
    };
    // A finger has no hover: the gesture plays once on the tap itself (as the finger lifts), never sticks.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch') playerRef.current?.play();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target === host && host.matches(':focus-visible')) playerRef.current?.play();
    };
    host.addEventListener('pointerenter', onPointerEnter as EventListener);
    host.addEventListener('pointerup', onPointerUp as EventListener);
    host.addEventListener('focusin', onFocusIn as EventListener);
    return () => {
      host.removeEventListener('pointerenter', onPointerEnter as EventListener);
      host.removeEventListener('pointerup', onPointerUp as EventListener);
      host.removeEventListener('focusin', onFocusIn as EventListener);
    };
  }, [hover, trigger]);

  const parts = definition.parts.map((part, index) => renderPart(part, index, definition.ms));
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
      {definition.motion ? <g {...motionProps(definition.motion, definition.ms)}>{parts}</g> : parts}
    </svg>
  );
}

function renderPart({ el: Element, attrs, motion }: IconPart, index: number, ms: number) {
  const draw = motion?.kind === 'draw' ? { pathLength: 1 } : {};
  return <Element key={index} {...attrs} {...draw} {...(motion ? motionProps(motion, ms) : {})} />;
}

/** The part's gesture as custom properties; animation.css applies them only while the icon is playing. */
function motionProps(motion: PartMotion, ms: number) {
  const delay = motion.delay ?? 0;
  const style: Record<string, string> = {
    '--ai-name': `ai-${motion.kind}`,
    '--ai-ms': `${Math.max(ms - delay, 60)}ms`,
  };
  if (delay) style['--ai-delay'] = `${delay}ms`;
  if (motion.x) style['--ai-x'] = `${motion.x}px`;
  if (motion.y) style['--ai-y'] = `${motion.y}px`;
  const scale = motion.scale ?? 1;
  if (motion.sx !== undefined || scale !== 1) style['--ai-sx'] = String(motion.sx ?? scale);
  if (motion.sy !== undefined || scale !== 1) style['--ai-sy'] = String(motion.sy ?? scale);
  if (motion.rotate) style['--ai-rotate'] = `${motion.rotate}deg`;
  if (motion.opacity !== undefined) style['--ai-opacity'] = String(motion.opacity);
  if (motion.origin) style['--ai-origin'] = motion.origin;
  return { 'data-motion': motion.kind, style: style as CSSProperties };
}
