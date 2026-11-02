import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '../src/client/components/ui/button.tsx';
const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save changes', onClick: fn() },
  decorators: [
    (Story) => (
      <div className="sb-stage">
        <Story />
      </div>
    ),
  ],
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save changes' }));
    await expect(args.onClick).toHaveBeenCalled();
  },
};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete replay' } };
export const Link: Story = { args: { variant: 'link', children: 'Read documentation' } };
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toBeDisabled();
  },
};
export const Busy: Story = {
  args: {
    disabled: true,
    'aria-busy': true,
    children: (
      <>
        <LoaderCircleIcon aria-hidden="true" /> Saving…
      </>
    ),
  },
};
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <DownloadIcon aria-hidden="true" /> Download replay
      </>
    ),
  },
};
export const IconOnly: Story = {
  args: {
    size: 'icon',
    'aria-label': 'Download replay',
    children: <DownloadIcon aria-hidden="true" />,
  },
};
export const Sizes: Story = {
  render: () => (
    <div className="sb-stack">
      {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
        <Button key={size} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
};
export const LongLabel: Story = {
  args: { children: 'Download the complete checkout investigation recording' },
};
export const Light: Story = { globals: { theme: 'light' } };
