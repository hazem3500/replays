import { waitFor } from 'storybook/test';

const finite = (animation: Animation) => animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY;
const moving = (animation: Animation) => animation.pending || animation.playState === 'running';

/** Waits until no finite animation is running, so axe measures final colours and no closing popup lingers. */
export const settled = (): Promise<void> =>
  waitFor(() => {
    if (document.getAnimations().some((animation) => finite(animation) && moving(animation))) throw new Error('Still animating');
  });

/** Waits for a Base UI popup to finish entering: its starting style is removed, then its transition ends. */
export async function opened(popup: HTMLElement): Promise<void> {
  await waitFor(() => {
    if (popup.hasAttribute('data-starting-style')) throw new Error('Popup is still entering');
  });
  await settled();
}
