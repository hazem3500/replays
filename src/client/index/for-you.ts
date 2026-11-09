import { PRODUCT_SLUG } from '../../shared/brand.ts';

/** The "For you" tab's id in the profile segments; `All` is the segment without one. */
export const FOR_YOU = 'for-you';

export type TabChoice = typeof FOR_YOU | 'all';

/** Where one viewer's last explicit tab choice lives, so a shared browser keeps each person's own. */
export const tabChoiceKey = (viewerId: string) => `${PRODUCT_SLUG}-index-tab:${viewerId}`;

export function parseTabChoice(raw: string | null): TabChoice | undefined {
  return raw === FOR_YOU || raw === 'all' ? raw : undefined;
}

/**
 * Which tab the index opens on. A link with its own view (`explicit`) or a viewer who cannot be matched (`canMatch`)
 * stays on All; a stored choice wins; with neither, For you is tried and `probe` asks the caller to fall back to
 * All when it turns out empty.
 */
export function landingTab({
  explicit,
  canMatch,
  stored,
}: {
  explicit: boolean;
  canMatch: boolean;
  stored: TabChoice | undefined;
}): { forYou: boolean; probe: boolean } {
  if (explicit || !canMatch || stored === 'all') return { forYou: false, probe: false };
  return { forYou: true, probe: stored === undefined };
}
