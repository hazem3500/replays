import { useRef } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { SwitchIconButton } from '@/components/icon-button.tsx';
import { HoverGlide, useSlidingPill } from '@/components/sliding-highlight.tsx';

import type { FeedView } from './Feed.tsx';

/** The flips draw no fill of their own: the group's hover and selected surfaces do. */
const QUIET = 'relative z-1 hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:hover:bg-transparent';

/**
 * The library's List and Grid flip, on the same model as every segmented control: a soft hover surface follows the
 * pointer, and one raised surface marks the chosen layout and glides to it on every change.
 */
export function ViewSwitch({ view, onChange }: { view: FeedView; onChange: (view: FeedView) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const pill = useSlidingPill(group, { selector: '[aria-pressed="true"]', value: view });
  return (
    <div ref={group} className="view-switch" role="group" aria-label="Layout">
      <HoverGlide container={group} itemSelector="button" />
      <span ref={pill} className="view-switch-pill" aria-hidden="true" />
      <SwitchIconButton label="List" className={QUIET} pressed={view === 'list'} onPressedChange={() => onChange('list')}>
        <AnimatedIcon name="list" />
      </SwitchIconButton>
      <SwitchIconButton label="Grid" className={QUIET} pressed={view === 'grid'} onPressedChange={() => onChange('grid')}>
        <AnimatedIcon name="layout-grid" />
      </SwitchIconButton>
    </div>
  );
}
