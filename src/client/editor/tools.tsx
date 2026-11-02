import { CaptionsIcon, EyeOffIcon, FastForwardIcon, ZoomInIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ReplayCaption, ReplaySpeedRange, ReplayZoomRegion } from '../../shared/effects.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import type { EffectKind } from './state.ts';

/** What a tool's render sees: today nothing beyond its own lane; a seam for host tools later. */
export type EditorToolContext = Record<string, never>;

/**
 * One editing tool (`editor.tools`): how it is added (the dock's Add menu, its key) and its timeline lane
 * (`editor.timeline.lanes`). `render` draws the tool's glyph, shared by the menu item and the lane's gutter.
 * Built-ins are `core:*`; the effect kinds themselves are still the closed union of the edits format.
 */
export interface EditorTool extends SlotDescriptor<EditorToolContext, ReactNode> {
  kind: EffectKind;
  /** The Add menu's item. */
  label: string;
  shortcut: string;
  testId: string;
  lane: {
    /** The track's name in the "Add track" menu. */
    track: string;
    /** The gutter's tooltip: the lane's name and how to add to it. */
    name: string;
    /** Shown on an empty lane. */
    empty: string;
    /** A region's name in its tooltip ("Zoom 0:01.0 to 0:03.0"). */
    region: string;
    /** A region's label on the lane. */
    label: (region: never) => string;
  };
}

export const EDITOR_TOOLS: readonly EditorTool[] = [
  {
    id: 'core:zoom',
    order: 100,
    kind: 'zoom',
    label: 'Zoom on clicks',
    shortcut: 'Z',
    testId: 'add-zoom',
    render: () => <ZoomInIcon aria-hidden="true" />,
    lane: {
      track: 'Zoom',
      name: 'Zoom: drag on the lane to add a zoom, Z zooms in on every click',
      empty: 'Zoom · drag to add · Z zooms in on every click',
      region: 'Zoom',
      label: (zoom: ReplayZoomRegion) => `${zoom.scale}×`,
    },
  },
  {
    id: 'core:speed',
    order: 200,
    kind: 'speed',
    label: 'Speed up',
    shortcut: 'F',
    testId: 'add-speed',
    render: () => <FastForwardIcon aria-hidden="true" />,
    lane: {
      track: 'Speed',
      name: 'Speed: drag on the lane to speed a stretch up (F)',
      empty: 'Speed · drag over a stretch to play it faster',
      region: 'Speed-up',
      label: (speed: ReplaySpeedRange) => `${speed.rate}×`,
    },
  },
  {
    id: 'core:blur',
    order: 300,
    kind: 'blur',
    label: 'Blur an area',
    shortcut: 'B',
    testId: 'add-blur',
    render: () => <EyeOffIcon aria-hidden="true" />,
    lane: {
      track: 'Blur',
      name: 'Blur: drag on the lane to hide part of the page (B)',
      empty: 'Blur · drag to hide part of the page while it shows',
      region: 'Blur',
      label: () => 'Blur',
    },
  },
  {
    id: 'core:caption',
    order: 400,
    kind: 'caption',
    label: 'Captions',
    shortcut: 'T',
    testId: 'add-caption',
    render: () => <CaptionsIcon aria-hidden="true" />,
    lane: {
      track: 'Captions',
      name: 'Captions: drag on the lane to add one, T adds captions from the steps',
      empty: 'Captions · drag to add one · T writes them from the steps',
      region: 'Caption',
      label: (caption: ReplayCaption) => caption.text,
    },
  },
];

/** The tools in order (the platform's slot merge comes later; today the built-ins sorted). */
export function editorTools(): readonly EditorTool[] {
  return [...EDITOR_TOOLS].sort((a, b) => a.order - b.order);
}

/** The timeline's effect lanes, one per tool, in tool order. */
export const editorTimelineLanes = editorTools;
