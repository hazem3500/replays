import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CommandSearch } from '../src/client/index/IndexHeader.tsx';
import type { FeedEntry } from '../src/client/index/Feed.tsx';

const summary = (id: string, title: string, host: string, capturedAt: string): FeedEntry => ({
  kind: 'session',
  id,
  summary: {
    id,
    title,
    url: `https://${host}/`,
    host,
    capturedAt,
    duration: 12_000,
    steps: 6,
    consoleErrors: 0,
    failedRequests: 0,
    source: 'agent',
  },
});

const entries = [
  summary('checkout', 'Checkout with a declined card', 'shop.example', '2026-10-27T09:00:00Z'),
  summary('signup', 'Signup form validation', 'app.example', '2026-10-26T12:00:00Z'),
  summary('search', 'Search filters reset on back', 'app.example', '2026-10-25T08:30:00Z'),
];

/** The index's first header row, so the search sits in its real slot beside the actions. */
function SearchRow({ compact, initial = '' }: { compact: boolean; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="index-shell" style={{ minHeight: 360 }}>
      <div className="index-head">
        <header className="topbar app-topbar">
          <div className="index-identity">
            <h1 className="index-title">replays</h1>
          </div>
          <div className="topbar-actions">
            <CommandSearch value={value} onChange={setValue} entries={entries} total={entries.length} compact={compact} />
          </div>
        </header>
      </div>
    </div>
  );
}

const meta = {
  title: 'Index/Search',
  parameters: { layout: 'fullscreen' },
  render: (args) => <SearchRow {...args} />,
  args: { compact: false },
} satisfies Meta<typeof SearchRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

/** Phones (canvas ≤ 640 px): a 40 px circle in the actions that grows across the row when entered. */
export const PhoneResting: Story = { args: { compact: true } };

/** A query still narrows the feed while the field rests: a dot on the glyph. */
export const PhoneWithQuery: Story = { args: { compact: true, initial: 'signup' } };

export const QuickResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search replays' }), 'app');
    const results = canvas.getByRole('listbox', { name: 'Quick results' });
    await expect(within(results).getAllByRole('option')).toHaveLength(3);
    await expect(within(results).getByRole('option', { name: /Signup form validation/ })).toHaveAttribute('aria-selected', 'true');
  },
};

export const PhoneClose: Story = {
  args: { compact: true, initial: 'signup' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole('combobox', { name: 'Search replays' });
    search.focus();
    await userEvent.click(await canvas.findByRole('button', { name: 'Close search' }));
    await expect(search).toHaveValue('');
    await expect(search).not.toHaveFocus();
  },
};
