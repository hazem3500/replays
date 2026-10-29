import { Columns2Icon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

import { commentsEnabled } from './comments/enabled.ts';
import { editingEnabled } from './config.ts';
import { Topbar, type TopbarMenuItem } from './Topbar.tsx';

/**
 * The labels the viewer's own parts show while its code and the replay load. They repeat the viewer chunk's (Viewer.tsx,
 * StepRail.tsx, viewer/inspector-tabs.ts) because this file renders before that chunk is there; keep them in sync.
 */
const STRINGS = {
  untitled: 'Opening replay',
  compare: 'Compare',
  shortcuts: 'Keyboard shortcuts',
  steps: 'Steps',
  stepCount: (count: number) => `1 of ${count}`,
  time: '0:00.0',
  tabs: ['Console', 'Network', 'Performance', 'Context'],
  comments: 'Comments',
};


/** Desktop's bar icons, in the viewer's order (Edit only where editing is on); phones keep Edit and More. */
const DESKTOP_ICONS: readonly AnimatedIconName[] = ['info', 'link', 'download'];
const ICON_BUTTON = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  'text-[var(--text-tertiary)] [&_svg:not([class*=size-])]:size-4',
);
/** Desktop's More menu holds the viewer's one fixed item; it waits, disabled, until the viewer is there. */
const WAITING_ITEMS: TopbarMenuItem[] = [
  { label: STRINGS.shortcuts, icon: <AnimatedIcon name="keyboard" />, onSelect: () => {}, disabled: true },
];
/** Stand-in rows in the rail; a long replay's list runs past the fold anyway. */
const MAX_RAIL_ROWS = 8;
const RAIL_WIDTHS = [64, 52, 72, 44, 58, 68, 48, 60];
/** Stable keys for stand-ins that only differ by position. */
const SLOTS = Array.from({ length: 24 }, (_, slot) => `slot-${slot}`);

/** A control the viewer will enable: the real button, disabled and out of the tab order until it is there. */
function InertButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button type="button" className={className} disabled tabIndex={-1} data-loading-action="">
      {children}
    </button>
  );
}

function InertIcon({ name }: { name: AnimatedIconName }) {
  return (
    <InertButton className={ICON_BUTTON}>
      <AnimatedIcon name={name} />
    </InertButton>
  );
}

function LoadingActions({ mobile, compare }: { mobile: boolean; compare: boolean }) {
  const edit = editingEnabled() ? <InertIcon name="pencil" /> : null;
  if (mobile)
    return (
      <span className="sk-actions" aria-hidden="true">
        {edit}
      </span>
    );
  return (
    <span className="sk-actions" aria-hidden="true">
      {compare ? (
        <>
          <span className="sk-layout-switch" />
          <InertButton className={ICON_BUTTON}>{null}</InertButton>
        </>
      ) : (
        <InertButton className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-[var(--text-tertiary)]')}>
          <Columns2Icon aria-hidden="true" />
          {STRINGS.compare}
        </InertButton>
      )}
      {edit}
      {DESKTOP_ICONS.map((name) => (
        <InertIcon key={name} name={name} />
      ))}
    </span>
  );
}

/**
 * The top bar while loading: the back link works, the title is the one the opening page knew (a quiet bar when the
 * replay was opened directly), and the viewer's icons wait inert in their places. `progress` hangs along its bottom edge.
 * A comparison's bar (a suite's) keeps the places of its layout switch and Add a recording instead of Compare.
 */
export function LoadingTopbar({
  title,
  mobile,
  compare = false,
  progress,
}: {
  title: string | undefined;
  mobile: boolean;
  compare?: boolean;
  progress: ReactNode;
}) {
  return (
    <div className="sk-topbar" data-untitled={title ? undefined : ''}>
      <Topbar
        title={title ?? STRINGS.untitled}
        compact={mobile}
        actions={<LoadingActions mobile={mobile} compare={compare} />}
        alwaysMenu
        menuItems={mobile ? [] : WAITING_ITEMS}
      />
      {progress}
    </div>
  );
}

/** The transport's row: play, the clock at zero and the seek bar's track, cut into the replay's steps when known. */
export function LoadingTransport({ steps }: { steps: number | undefined }) {
  const segments = Math.max(1, Math.min(steps ?? 1, 24));
  return (
    <div className="transport sk-transport" aria-hidden="true">
      <InertButton className={cn(ICON_BUTTON, 'play-button')}>
        <AnimatedIcon name="play" className="filled-icon" />
      </InertButton>
      <span className="transport-time">
        <strong>{STRINGS.time}</strong>
      </span>
      <span className="scrubber sk-scrub">
        {SLOTS.slice(0, segments).map((slot) => (
          <span key={slot} className="sk-segment" />
        ))}
      </span>
    </div>
  );
}

/** The steps rail: its heading with the count the opening page knew, then stand-in step rows. */
export function LoadingRail({ steps }: { steps: number | undefined }) {
  const rows = Math.min(steps ?? 5, MAX_RAIL_ROWS);
  return (
    <aside className="timeline-panel" aria-hidden="true">
      <div className="section-heading">
        <h2>{STRINGS.steps}</h2>
        {steps ? <span className="section-count">{STRINGS.stepCount(steps)}</span> : null}
      </div>
      <div className="sk-steps">
        {RAIL_WIDTHS.slice(0, rows).map((width) => (
          <div key={width} className="step sk-step">
            <span className="skeleton sk-step-icon" />
            <span className="skeleton" style={{ width: `${width}%` } satisfies CSSProperties} />
            <span className="skeleton skeleton-thin sk-step-time" />
          </div>
        ))}
      </div>
    </aside>
  );
}

/** The open panel's stand-in rows under the tab row, at the inspector's row height. */
export function LoadingPanel() {
  return (
    <div className="sk-panel" aria-hidden="true">
      {RAIL_WIDTHS.slice(0, 5).map((width) => (
        <div key={width} className="sk-panel-row">
          <span className="skeleton skeleton-thin sk-step-time" />
          <span className="skeleton" style={{ width: `${width}%` } satisfies CSSProperties} />
        </div>
      ))}
    </div>
  );
}

/** The inspector's tab row: desktop's labels, or phones' icon tabs (Steps first when there are steps). */
export function LoadingTabs({ mobile, steps }: { mobile: boolean; steps: number | undefined }) {
  const tabs = commentsEnabled() ? [...STRINGS.tabs, STRINGS.comments] : STRINGS.tabs;
  const count = mobile ? tabs.length + (steps ? 1 : 0) : 0;
  return (
    <div className={mobile ? 'inspector-tabs sk-tabs-phone' : 'inspector-tabs sk-tabs'} aria-hidden="true">
      <div className="inspector-tablist">
        {mobile
          ? SLOTS.slice(0, count).map((slot) => (
              <span key={slot} className="inspector-tab sk-tab">
                <span className="skeleton sk-tab-icon" />
              </span>
            ))
          : tabs.map((label) => (
              <span key={label} className="inspector-tab sk-tab">
                {label}
              </span>
            ))}
      </div>
    </div>
  );
}
