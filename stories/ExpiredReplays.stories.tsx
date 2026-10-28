import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { ExpiredReplays } from '../src/client/index/ExpiredReplays.tsx';
import { expiredReplaysQuery } from '../src/client/index/expired-query.ts';
import type { ExpiredReplays as ExpiredReplaysBody } from '../src/shared/expired.ts';

const records: ExpiredReplaysBody = {
  days: 30,
  records: [
    {
      id: 'checkout',
      title: 'Checkout with a declined card',
      host: 'shop.example',
      capturedAt: '2026-07-20T10:00:00.000Z',
      expiredAt: '2026-10-20T10:00:00.000Z',
      retentionDays: 90,
      profile: 'triage',
    },
    {
      id: 'signup',
      title: 'Signup form validation',
      host: 'app.example',
      capturedAt: '2026-09-01T10:00:00.000Z',
      expiredAt: '2026-10-01T10:00:00.000Z',
      retentionDays: 30,
    },
  ],
};

/** The section with its records already fetched, as the index shows it under the feed. */
function Seeded() {
  const client = new QueryClient();
  client.setQueryData(expiredReplaysQuery.queryKey, records);
  return (
    <QueryClientProvider client={client}>
      <div className="index-shell" style={{ maxWidth: 720 }}>
        <ExpiredReplays query="" profile={undefined} profiles={[{ id: 'triage', label: 'Triage', order: 0, retentionDays: 90 }]} />
      </div>
    </QueryClientProvider>
  );
}

const meta = { title: 'Index/Expired replays', component: Seeded, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Seeded>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Folded: the count and "Show expired". */
export const Folded: Story = {};

/** Open: dimmed, details-only rows saying when and under which window each replay was removed. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show expired' }));
    await expect(canvas.getByText('Checkout with a declined card')).toBeVisible();
    await expect(canvas.getByText(/after 90 days, the Triage window/)).toBeVisible();
  },
};
