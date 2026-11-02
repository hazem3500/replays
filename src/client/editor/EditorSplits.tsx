import type { RefObject } from 'react';

import { readSplitterSize, Splitter, SplitterEdgeTab } from '@/components/ui/splitter.tsx';

import { useDockHeights } from '../hooks/use-dock-heights.ts';
import { readStorage, writeStorage } from '../storage.ts';
import { editorStrings } from './strings.ts';

const DOCK_KEY = 'editor:dock';
const DOCK_MIN = 148;
const DOCK_FALLBACK = 168;
const PANEL_KEY = 'editor:panel';
const PANEL_COLLAPSED_KEY = 'editor:panel-collapsed';
export const PANEL_WIDTH = 280;
const PANEL_MIN = 240;
const PANEL_MAX = 400;

const largestDock = () => Math.max(DOCK_MIN, Math.round(window.innerHeight * 0.65));

/** The dock's cap as last set (by default the largest, so every lane shows). */
export const initialDockCap = () => readSplitterSize(DOCK_KEY, largestDock(), DOCK_MIN, largestDock());
export const initialPanelWidth = () => readSplitterSize(PANEL_KEY, PANEL_WIDTH, PANEL_MIN, PANEL_MAX);
export const initialPanelCollapsed = () => readStorage(PANEL_COLLAPSED_KEY) === '1';
export const rememberPanelCollapsed = (collapsed: boolean) => writeStorage(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');

/**
 * The seam above the dock. The dock is as tall as its content up to the cap this sets; the seam works from the
 * rendered height and stops at the content's height (no empty band under the timeline).
 */
export function DockSplit({
  shell,
  dock,
  onChange,
}: {
  shell: RefObject<HTMLElement | null>;
  dock: RefObject<HTMLElement | null>;
  onChange: (cap: number) => void;
}) {
  const { rendered, natural } = useDockHeights(dock, DOCK_FALLBACK);
  const max = Math.max(DOCK_MIN, Math.min(largestDock(), natural));
  return (
    <Splitter
      orientation="horizontal"
      side="end"
      value={rendered}
      min={DOCK_MIN}
      max={max}
      defaultValue={max}
      step={24}
      onChange={onChange}
      onPreview={(size) => shell.current?.style.setProperty('--dock-height', `${size}px`)}
      storageKey={DOCK_KEY}
      settleTarget={shell}
      label={editorStrings.dock.resize}
      className="editor-dock-split"
      testId="editor-dock-resizer"
    />
  );
}

/** The seam beside the presentation panel: drag to resize, snap to its resting width, fold it past the minimum. */
export function PanelSplit({
  shell,
  width,
  onWidthChange,
  collapsed,
  onCollapsedChange,
}: {
  shell: RefObject<HTMLElement | null>;
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <Splitter
      orientation="vertical"
      side="end"
      value={width}
      min={PANEL_MIN}
      max={PANEL_MAX}
      defaultValue={PANEL_WIDTH}
      snapPoints={[PANEL_WIDTH]}
      collapsible
      collapsed={collapsed}
      onChange={onWidthChange}
      onCollapsedChange={onCollapsedChange}
      onPreview={(size, folded) => shell.current?.style.setProperty('--editor-panel-width', `${folded ? 0 : size}px`)}
      storageKey={PANEL_KEY}
      settleTarget={shell}
      label={editorStrings.presentation.resize}
      className="editor-panel-split"
      testId="editor-panel-resizer"
    />
  );
}

export function PanelEdgeTab({ onOpen }: { onOpen: () => void }) {
  return <SplitterEdgeTab label={editorStrings.presentation.show} onOpen={onOpen} className="editor-panel-edge-tab" />;
}
