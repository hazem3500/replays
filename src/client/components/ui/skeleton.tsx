import { type CSSProperties, createContext, type ReactNode, use } from 'react';

import { useDelayedVisible } from '@/hooks/use-delayed-visible.ts';
import { cn } from '@/lib/utils.ts';

/** A placeholder shows only when a load outlasts this; shorter ones never flash. */
export const SKELETON_DELAY_MS = 150;

/** A skeleton already inside a delayed shell (the page's loading screen) shows at once; its own delay would stack. */
export const SkeletonDelay = createContext(SKELETON_DELAY_MS);

type Size = number | string;
const px = (value: Size | undefined) => (typeof value === 'number' ? `${value}px` : value);

/**
 * The one placeholder shape: a muted block with a slow shimmer (still under reduced motion), rounded like the content
 * it stands for. `pill` and `dot` round fully; the default radius matches text and bars.
 */
export function Skeleton({
  w,
  h,
  shape,
  className,
  style,
}: {
  w?: Size;
  h?: Size;
  shape?: 'pill' | 'dot';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn('skel', className)}
      data-shape={shape}
      style={{ ...(w === undefined ? null : { width: px(w) }), ...(h === undefined ? null : { height: px(h) }), ...style }}
    />
  );
}

/**
 * Wraps a skeleton: it holds its space from the first frame (so nothing shifts) but stays invisible until
 * SKELETON_DELAY_MS, and tells assistive tech what is loading.
 */
export function SkeletonFrame({
  label,
  panel,
  className,
  children,
}: {
  label: string;
  panel: string;
  className?: string;
  children: ReactNode;
}) {
  const shown = useDelayedVisible(use(SkeletonDelay));
  return (
    <div
      className={cn('skel-frame', className)}
      data-panel={panel}
      data-shown={shown ? '' : undefined}
      aria-busy="true"
      data-testid="panel-pending"
    >
      <span className="visually-hidden" role="status">
        {label}
      </span>
      <div className="skel-body" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
