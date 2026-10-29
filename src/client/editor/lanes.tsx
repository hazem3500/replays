import { CaptionsIcon, EyeOffIcon, FastForwardIcon, ZoomInIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ReplayEdits } from '../../shared/edits.ts';
import type { ReplayBlur, ReplayCaption, ReplaySpeedRange, ReplayZoomRegion } from '../../shared/effects.ts';
import type { EffectKind } from './state.ts';

const zoomLabel = (zoom: ReplayZoomRegion) => `${zoom.scale}×`;
const speedLabel = (speed: ReplaySpeedRange) => `${speed.rate}×`;
const blurLabel = (blur: ReplayBlur) => (blur.style === 'redact' ? 'Redact' : 'Blur');
const captionLabel = (caption: ReplayCaption) => caption.text;

/** Each effect lane's glyph and how one of its regions is labelled, shared by the timeline and its phone loading frame. */
export const LANE_GLYPHS: Array<{ kind: EffectKind; icon: ReactNode; label: (region: never) => string }> = [
  { kind: 'zoom', icon: <ZoomInIcon />, label: zoomLabel },
  { kind: 'speed', icon: <FastForwardIcon />, label: speedLabel },
  { kind: 'blur', icon: <EyeOffIcon />, label: blurLabel },
  { kind: 'caption', icon: <CaptionsIcon />, label: captionLabel },
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
  return LANE_GLYPHS.filter((lane) => lists[lane.kind].length > 0).map((lane) => ({
    kind: lane.kind,
    icon: lane.icon,
    regions: lists[lane.kind],
  }));
}
