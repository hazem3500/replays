import { CaptionsIcon, EyeOffIcon, FastForwardIcon, ZoomInIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ReplayEdits } from '../../shared/edits.ts';
import type { ReplayBlur, ReplayCaption, ReplaySpeedRange, ReplayZoomRegion } from '../../shared/effects.ts';
import type { EffectKind } from './state.ts';

const zoomLabel = (zoom: ReplayZoomRegion) => `${zoom.scale}×`;
const speedLabel = (speed: ReplaySpeedRange) => `${speed.rate}×`;
const blurLabel = (blur: ReplayBlur) => (blur.style === 'redact' ? 'Redact' : 'Blur');
const captionLabel = (caption: ReplayCaption) => caption.text;

/**
 * Each effect lane: its name (the gutter's tooltip), glyph, and how one of its regions is labelled. Shared by the
 * timeline and the phone's loading frame, so both draw the same lanes.
 */
export const LANES: Array<{ kind: EffectKind; name: string; empty: string; icon: ReactNode; label: (region: never) => string }> = [
  {
    kind: 'zoom',
    name: 'Zoom: drag on the lane to add a zoom, Z zooms in on every click',
    empty: 'Zoom · drag to add · Z zooms in on every click',
    icon: <ZoomInIcon />,
    label: zoomLabel,
  },
  {
    kind: 'speed',
    name: 'Speed: drag on the lane to speed a stretch up (F)',
    empty: 'Speed · drag over a stretch to play it faster',
    icon: <FastForwardIcon />,
    label: speedLabel,
  },
  {
    kind: 'blur',
    name: 'Blur: drag on the lane to hide part of the page (B)',
    empty: 'Blur · drag to hide part of the page while it shows',
    icon: <EyeOffIcon />,
    label: blurLabel,
  },
  {
    kind: 'caption',
    name: 'Captions: drag on the lane to add one, T adds captions from the steps',
    empty: 'Captions · drag to add one · T writes them from the steps',
    icon: <CaptionsIcon />,
    label: captionLabel,
  },
];

export interface LaneRegion {
  id: string;
  from: number;
  to: number;
  label: string;
}

function labelled<T extends { id: string; from: number; to: number }>(items: readonly T[] | undefined, label: (item: T) => string) {
  return (items ?? []).map((item): LaneRegion => ({ id: item.id, from: item.from, to: item.to, label: label(item) }));
}

/** The lanes a phone timeline shows for these edits (only those holding regions), in lane order, with their labels. */
export function laneRegions(edits: ReplayEdits) {
  const lists: Record<EffectKind, LaneRegion[]> = {
    zoom: labelled(edits.zooms, zoomLabel),
    speed: labelled(edits.speeds, speedLabel),
    blur: labelled(edits.blurs, blurLabel),
    caption: labelled(edits.captions, captionLabel),
  };
  return LANES.filter((lane) => lists[lane.kind].length > 0).map((lane) => ({
    kind: lane.kind,
    icon: lane.icon,
    regions: lists[lane.kind],
  }));
}
