import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Disclosure } from '../../src/client/components/ui/disclosure.tsx';
import { EmptyState } from '../../src/client/components/ui/empty-state.tsx';
import { Progress, ProgressLabel, ProgressValue } from '../../src/client/components/ui/progress.tsx';

const meta = {
  title: 'Components/Feedback',
  component: EmptyState,
  args: { title: 'No replays yet', body: 'Record a session or drop a bundle here to see it.' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['empty', 'error', 'offline'] },
    variant: { control: 'inline-radio', options: ['region', 'compact', 'banner'] },
  },
  parameters: {
    docs: {
      description: {
        component:
          'One empty and error state for every surface. Props are plain data, so plugins and slot descriptors can describe one too.',
      },
    },
  },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

const record = fn();

export const Empty: Story = {
  args: { actions: [{ id: 'record', label: 'Record a session', primary: true, onSelect: record }] },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Record a session' }));
    await expect(record).toHaveBeenCalledOnce();
  },
};

export const FilteredToNothing: Story = {
  args: {
    title: 'No replays match',
    body: 'Clear a filter to see more.',
    icon: 'filter',
    details: { chips: { label: 'Active filters', items: ['Host demo.example', 'Has errors'] } },
    actions: [{ id: 'clear', label: 'Clear filters', onSelect: fn() }],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('list', { name: 'Active filters' })).toBeVisible();
  },
};

export const LoadError: Story = {
  args: {
    tone: 'error',
    title: "Couldn't load replays",
    body: 'The server answered 503.',
    details: { status: 'Retrying in 8 seconds' },
    actions: [{ id: 'retry', label: 'Try again', primary: true, onSelect: fn() }],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent("Couldn't load replays");
  },
};

export const OfflineBanner: Story = {
  args: { tone: 'offline', variant: 'banner', title: "You're offline", body: 'Showing replays saved on this device.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent("You're offline");
  },
};

export const CompactInPanel: Story = {
  args: { variant: 'compact', icon: 'inbox', title: 'No console output', body: 'This recording logged nothing.' },
  decorators: [
    (Story) => (
      <div className="sb-panel" style={{ maxWidth: 360, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export const UploadProgress: Story = {
  render: () => (
    <div className="sb-stack" style={{ maxWidth: 360 }}>
      {[0, 40, 100].map((value) => (
        <Progress key={value} value={value}>
          <ProgressLabel>Uploading bundle</ProgressLabel>
          <ProgressValue />
        </Progress>
      ))}
    </div>
  ),
};

export const FoldedDetails: Story = {
  render: () => (
    <Disclosure summary="Advanced: agent credentials">
      <p>Credentials let a coding agent upload replays without signing in.</p>
    </Disclosure>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = canvas.getByText(/^Credentials let/);
    await expect(body).not.toBeVisible();
    await userEvent.click(canvas.getByText('Advanced: agent credentials'));
    await expect(body).toBeVisible();
  },
};
