import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { DataStorage } from '../../src/client/settings/DataStorage.tsx';
import { storageSettings } from '../mocks/data-storage.ts';

const storage = storageSettings();
const meta = {
  title: 'App/Data and storage',
  component: DataStorage,
  beforeEach: () => {
    storage.reset();
  },
  parameters: { network: { handlers: storage.handlers } },
  decorators: [
    (Story) => (
      <section aria-label="Data and storage" style={{ maxWidth: 640, padding: 20 }}>
        <Story />
      </section>
    ),
  ],
} satisfies Meta<typeof DataStorage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StoragePolicyAndTrash: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('gcs')).toBeVisible();
    await expect(canvas.getByText('30 days')).toBeVisible();
    await expect(canvas.getByText('old-replay')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(canvas.queryByText('old-replay')).toBeNull());
    await expect(canvas.getByRole('status')).toHaveTextContent('Replay restored.');
  },
};

export const ConfirmedBulkDeletion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('gcs');
    await userEvent.click(canvas.getByRole('button', { name: 'Delete all replays' }));
    const confirmation = await within(document.body).findByRole('dialog', { name: 'Delete all replays?' });
    await expect(storage.deletions()).toBe(0);
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await expect(storage.deletions()).toBe(0);
    await userEvent.click(canvas.getByRole('button', { name: 'Delete all replays' }));
    const reopened = await within(document.body).findByRole('dialog', { name: 'Delete all replays?' });
    await userEvent.click(within(reopened).getByRole('button', { name: 'Delete all replays' }));
    await waitFor(() => expect(storage.deletions()).toBe(1));
    await expect(await canvas.findByText('replay-one')).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('2 replays moved to trash.');
  },
};
