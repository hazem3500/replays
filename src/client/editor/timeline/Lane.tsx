import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from 'react';

import { Hint } from '@/components/icon-button.tsx';

import { useReveal } from '../../hooks/use-reveal.ts';

/**
 * A lane: its glyph in the gutter (named by a tooltip) and its regions on the track. An empty lane says in place what
 * it is and how to add to it (`empty`), in the quietest text, so it explains itself without hover.
 */
export function Lane({
  name,
  icon,
  kind,
  children,
  onTrackPointerDown,
  tall = false,
  empty,
  reveal = false,
}: {
  name: string;
  icon: ReactNode;
  kind: string;
  children: ReactNode;
  onTrackPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  tall?: boolean;
  empty?: string | undefined;
  /** Keyboard and menu-created effects reveal their track in the compact scrolling dock. */
  reveal?: boolean;
}) {
  const lane = useRef<HTMLDivElement>(null);
  useReveal(lane, reveal);
  return (
    <div ref={lane} className="tl-lane" data-kind={kind} data-tall={tall || undefined} role="group" aria-label={name}>
      <Hint label={name} side="left">
        <span className="tl-gutter" aria-hidden="true">
          {icon}
        </span>
      </Hint>
      <div className="tl-track" data-testid={`lane-${kind}`} onPointerDown={onTrackPointerDown}>
        {empty ? (
          <span className="tl-lane-empty" aria-hidden="true">
            {empty}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
