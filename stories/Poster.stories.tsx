import { useLayoutEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Poster } from '../src/client/index/Poster.tsx';
import posterUrl from './fixtures/poster.svg?url';
const meta = {
  title: 'App/Index/Posters',
  component: Poster,
  args: { id: undefined, host: 'checkout.northstar.demo.test', size: 'card' },
  decorators: [
    (Story) => (
      <div className="sb-stage" style={{ maxWidth: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Poster>;
export default meta;
type Story = StoryObj<typeof meta>;
function ReadyPoster() {
  const root = useRef<HTMLDivElement>(null);
  // Change only the story's image source, before paint, to a checked-in visual fixture.
  useLayoutEffect(() => {
    const image = root.current?.querySelector('img');
    if (image) {
      image.loading = 'eager';
      image.src = posterUrl;
    }
  }, []);
  return (
    <div ref={root}>
      <Poster id="storybook-ready" host="checkout.northstar.demo.test" size="card" badge="0:12" />
    </div>
  );
}
export const Ready: Story = {
  render: () => <ReadyPoster />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.poster')).toHaveAttribute('data-phase', 'ready'));
  },
};
export const Loading: Story = {
  args: { id: 'storybook-pending' },
  parameters: { api: { state: 'loading' } },
};
export const None: Story = {};
export const RowPlaceholder: Story = { args: { size: 'row' } };
export const MiniPlaceholder: Story = { args: { size: 'mini' } };
export const LongHost: Story = {
  args: { host: 'a-very-long-staging-environment.checkout.northstar.demo.test', badge: '24 runs' },
};
