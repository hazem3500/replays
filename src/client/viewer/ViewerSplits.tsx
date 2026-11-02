import type { RefObject } from 'react';

import { Splitter, SplitterEdgeTab } from '@/components/ui/splitter.tsx';

import { defaultInspectorHeight, maxInspectorHeight, MIN_INSPECTOR_HEIGHT } from './inspector-size.ts';
import { MIN_STEPS_WIDTH, STEPS_WIDTH_KEY } from './StepRail.tsx';

const STRINGS = {
  inspector: 'Resize diagnostics panel',
  rail: 'Resize steps panel',
  showRail: 'Show steps',
};

/** The rail's resting width; the layout's --rail-width (viewer-layout.css) is the same number. */
const RAIL_WIDTH = 300;
const MAX_RAIL_WIDTH = 480;

/** The seam between the player and the diagnostics panel: drag, snap to the default, fold past the minimum. */
export function InspectorSplit({
  shell,
  height,
  onHeightChange,
  collapsed,
  onCollapsedChange,
  storageKey,
}: {
  shell: RefObject<HTMLElement | null>;
  /** Where the committed height is kept: the open view's own key. */
  storageKey: string;
  height: number;
  onHeightChange: (height: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const fallback = defaultInspectorHeight();
  return (
    <Splitter
      orientation="horizontal"
      side="end"
      value={height}
      min={MIN_INSPECTOR_HEIGHT}
      max={maxInspectorHeight()}
      defaultValue={fallback}
      snapPoints={[fallback]}
      collapsible
      collapsed={collapsed}
      onChange={onHeightChange}
      onCollapsedChange={onCollapsedChange}
      onPreview={(size, folded) =>
        shell.current?.style.setProperty('--inspector-height', folded ? 'var(--inspector-folded-height)' : `${size}px`)
      }
      storageKey={storageKey}
      settleTarget={shell}
      label={STRINGS.inspector}
      className="inspector-split"
      testId="inspector-resizer"
    />
  );
}

/** The seam between the player and the steps rail; folding the rail leaves an edge tab that brings it back. */
export function RailSplit({
  workspace,
  width,
  onWidthChange,
  collapsed,
  onCollapsedChange,
}: {
  workspace: RefObject<HTMLElement | null>;
  width: number | undefined;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <Splitter
      orientation="vertical"
      side="end"
      value={width ?? RAIL_WIDTH}
      min={MIN_STEPS_WIDTH}
      max={MAX_RAIL_WIDTH}
      defaultValue={RAIL_WIDTH}
      snapPoints={[RAIL_WIDTH]}
      collapsible
      collapsed={collapsed}
      onChange={onWidthChange}
      onCollapsedChange={onCollapsedChange}
      onPreview={(size) => {
        // why: the collapsed grid hides the rail; its width must remain available when only the fold flag changes.
        workspace.current?.style.setProperty('--steps-width', `${size}px`);
      }}
      storageKey={STEPS_WIDTH_KEY}
      settleTarget={workspace}
      label={STRINGS.rail}
      className="rail-split"
      testId="steps-resizer"
    />
  );
}

export function RailEdgeTab({ onOpen }: { onOpen: () => void }) {
  return <SplitterEdgeTab label={STRINGS.showRail} onOpen={onOpen} className="rail-edge-tab" />;
}
