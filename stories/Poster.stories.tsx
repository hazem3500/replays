import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { Poster } from '../src/client/index/Poster.tsx';
import { rgbaToThumbHash, thumbHashToBase64 } from '../src/shared/thumbhash-encode.ts';

const HEADER = [32, 36, 48];
const BUTTON = [34, 160, 90];
const PAGE = [244, 246, 248];

/** A fixture page: a dark header band over a light body with a green call to action, like a checkout screenshot. */
function fixtureColor(x: number, y: number) {
  if (y < 6) return HEADER;
  return y > 26 && y < 32 && x > 6 && x < 22 ? BUTTON : PAGE;
}

function fixtureHash() {
  const w = 64;
  const h = 40;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set([...fixtureColor(x, y), 255], (y * w + x) * 4);
  return thumbHashToBase64(rgbaToThumbHash(w, h, rgba));
}

const meta = {
  title: 'Index/Poster placeholder',
  component: Poster,
  parameters: { layout: 'centered' },
  args: { id: undefined, host: 'shop.example', size: 'card' },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Poster>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No ThumbHash (an older replay, or posters off): the host's initial on a calm tile. */
export const Plain: Story = {};

/** The poster's colours and shape from its ThumbHash, until the real poster crossfades in. */
export const ThumbHash: Story = {
  args: { thumbhash: fixtureHash() },
  play: async ({ canvasElement }) => {
    const tile = canvasElement.querySelector<HTMLElement>('.poster-placeholder');
    await expect(tile?.dataset.thumbhash).toBe('');
    await expect(tile?.style.backgroundImage).toMatch(/data:image\/png;base64,/);
  },
};

export const ThumbHashRow: Story = { args: { thumbhash: fixtureHash(), size: 'row' } };
