import { createContext, type PointerEvent, type ReactNode, type Ref, useContext, useRef, useState } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { type HTMLMotionProps, LazyMotion, MotionConfig } from 'motion/react';
import * as m from 'motion/react-m';

import { useRunMenuArrowMotion } from '../hooks/use-feed-control-motion.ts';
import { useMediaQuery } from '../media.ts';

import { SHEET_LIFT, SHOWN_SHEETS } from './suite-stack.ts';

const HOVER_MODES = {
  fine: { full: { hover: true, reduced: false }, reduced: { hover: true, reduced: true } },
  touch: { full: { hover: false, reduced: false }, reduced: { hover: false, reduced: true } },
} as const;
const HoverContext = createContext<{ hover: boolean; reduced: boolean }>(HOVER_MODES.touch.reduced);
const loadFeatures = () => import('./motion-features.ts').then((module) => module.domAnimation);
const EASE = [0.23, 1, 0.32, 1] as const;

/** Loads index gesture features independently of the initial library render. */
export function FeedMotion({ children }: { children: ReactNode }) {
  const fine = useMediaQuery('(hover: hover) and (pointer: fine)');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}>
        <HoverContext value={HOVER_MODES[fine ? 'fine' : 'touch'][reduced ? 'reduced' : 'full']}>{children}</HoverContext>
      </MotionConfig>
    </LazyMotion>
  );
}

/** Preserves the familiar card lift while its shadow and press share Motion's interruption handling. */
export function MotionFeedItem({
  view,
  children,
  ...props
}: Omit<HTMLMotionProps<'li'>, 'children'> & { children?: ReactNode; view: 'list' | 'grid'; ref?: Ref<HTMLLIElement> | undefined }) {
  const { hover, reduced } = useContext(HoverContext);
  const [pressed, setPressed] = useState(false);
  const press = hover && !reduced;
  const release = () => setPressed(false);
  return (
    <m.li
      {...props}
      initial={false}
      // why: whileTap would give the row tabindex 0, a second tab stop around its own link; pointer events drive the press.
      animate={pressed ? 'press' : 'rest'}
      {...(press
        ? {
            onPointerDown: (event: PointerEvent<HTMLLIElement>) => {
              if (event.isPrimary && event.button === 0) setPressed(true);
            },
            onPointerUp: release,
            onPointerCancel: release,
            onPointerLeave: release,
          }
        : {})}
      {...(hover ? { whileHover: 'hover' } : {})}
      variants={{
        rest: { y: 0, scale: 1, transition: { duration: reduced ? 0 : 0.18, ease: EASE } },
        press: { scale: view === 'grid' ? 0.985 : 0.995, transition: { duration: 0.18, ease: EASE } },
        hover: { y: view === 'grid' && !reduced ? -2 : 0, transition: { duration: reduced ? 0 : 0.22, ease: EASE } },
      }}
    >
      <m.span className="feed-hover" aria-hidden="true" variants={{ rest: { opacity: 0 }, hover: { opacity: 1 } }} />
      <span className="feed-highlight" aria-hidden="true" />
      {children}
    </m.li>
  );
}

/** Thumbnail planes retain their depth while the same parent gesture fans the stack. */
export function MotionRearSheet({
  depth,
  grid,
  children,
  ...props
}: Omit<HTMLMotionProps<'span'>, 'children'> & { children?: ReactNode; depth: number; grid: boolean }) {
  const { reduced } = useContext(HoverContext);
  const scale = 1 - depth * 0.035;
  const opacity = depth > SHOWN_SHEETS ? 0 : 1 - depth * 0.15;
  const y = Math.min(depth, SHOWN_SHEETS);
  const lift = SHEET_LIFT[grid ? 'grid' : 'list'];
  return (
    <m.span
      {...props}
      variants={{
        rest: { y: -lift.rest * y, scaleX: scale, scaleY: grid ? scale : 1, opacity },
        hover: { y: -(reduced ? lift.rest : lift.hover) * y, scaleX: scale, scaleY: grid ? scale : 1, opacity },
      }}
      transition={{ duration: reduced ? 0 : 0.2, ease: EASE }}
    >
      {children}
    </m.span>
  );
}

/** Keeps the suite navigation cue on Base UI's own highlighted state. */
export function RunMenuArrow() {
  const arrow = useRef<SVGSVGElement>(null);
  useRunMenuArrowMotion(arrow);
  return <ArrowRightIcon ref={arrow} className="run-menu-arrow" aria-hidden="true" />;
}
