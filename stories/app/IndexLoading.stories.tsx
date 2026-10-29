import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { ScopeBar } from '../../src/client/index/IndexHeader.tsx';
import { RefreshLine, ScopeCount, type ScopeCountState } from '../../src/client/index/ScopeCount.tsx';

/** The index toolbar's count row as a filtered view shows it, with the header's refresh hairline. */
function CountRow({ replays, suites, state }: { replays: number | undefined; suites: number; state: ScopeCountState }) {
  return (
    <div className="index-shell">
      <div className="index-head">
        <ScopeBar count={<ScopeCount replays={replays} suites={suites} shown state={state} />} />
        <RefreshLine active={state === 'updating'} />
      </div>
    </div>
  );
}

const meta = {
  title: 'App/Index loading',
  component: CountRow,
  parameters: { layout: 'fullscreen' },
  args: { replays: 22, suites: 4, state: 'ready' },
} satisfies Meta<typeof CountRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Known data: the exact count at once, no skeleton. */
export const Settled: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('22 replays · 4 suites');
  },
};

/** A refresh: the count it had stays (dimmed after 300 ms) and a quiet hairline runs along the header. */
export const Updating: Story = {
  args: { state: 'updating' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Updating replays…');
    await expect(within(canvasElement).getByText('replays', { exact: false })).toBeVisible();
  },
};

/** The first load of a filtered view: a bar the height of the count's text holds its place. */
export const FirstLoad: Story = { args: { replays: undefined, state: 'loading' } };
