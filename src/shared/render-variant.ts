/**
 * A video export's variant, shared by the server (job identity, download name) and the client (request,
 * label, filename). The defaults match the player's: 1×, skip inactive on, no captions. Names, queries and
 * labels list only deviations from them (skip off reads "full idle time", `-full`).
 */
export interface RenderVariant {
  /** Playback speed (src/client/render/frames.ts RENDER_SPEEDS). */
  speed: number;
  /** Idle gaps fast-forwarded as the viewer's "skip inactive" does (default on, like the player). */
  skipInactive: boolean;
  /** The viewer's step captions drawn in. */
  captions: boolean;
}

export const DEFAULT_RENDER_VARIANT: RenderVariant = { speed: 1, skipInactive: true, captions: false };

/** `<id>[-<speed>x][-full][-captions].mp4`, e.g. `tracker-2x-full-captions.mp4` (`-full`: idle time not skipped); the id is a safe slug. */
export function renderFilename(id: string, variant: Partial<RenderVariant> = {}) {
  const speed = variant.speed ?? 1;
  return `${id}${speed === 1 ? '' : `-${speed}x`}${variant.skipInactive === false ? '-full' : ''}${variant.captions ? '-captions' : ''}.mp4`;
}

/** The API query selecting a variant (`?speed=2&skipInactive=0&captions=1`), defaults left out; '' for the default. */
export function renderQuery(variant: Partial<RenderVariant> = {}) {
  const params = new URLSearchParams();
  if ((variant.speed ?? 1) !== 1) params.set('speed', String(variant.speed));
  if (variant.skipInactive === false) params.set('skipInactive', '0');
  if (variant.captions) params.set('captions', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** The non-default options in words, for labels: ['2×', 'captions', 'full idle time']. */
export function renderVariantParts(variant: Partial<RenderVariant> = {}) {
  const parts: string[] = [];
  if ((variant.speed ?? 1) !== 1) parts.push(`${variant.speed}×`);
  if (variant.captions) parts.push('captions');
  if (variant.skipInactive === false) parts.push('full idle time');
  return parts;
}
