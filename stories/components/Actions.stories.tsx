import type { Meta, StoryObj } from '@storybook/react-vite';
import { DownloadIcon, PlayIcon, Trash2Icon } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Badge } from '../../src/client/components/ui/badge.tsx';
import { Button } from '../../src/client/components/ui/button.tsx';
import { StatusLabel } from '../../src/client/components/ui/status-label.tsx';

const VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;
const SIZES = ['xs', 'sm', 'default', 'lg'] as const;

const meta = {
  title: 'Components/Actions',
  component: Button,
  args: { children: 'Share replay', variant: 'default', size: 'default', disabled: false, onClick: fn() },
  argTypes: {
    variant: { control: 'select', options: VARIANTS },
    size: { control: 'select', options: [...SIZES, 'icon', 'icon-sm', 'icon-lg'] },
  },
  parameters: { docs: { description: { component: 'Buttons, badges and status labels from `src/client/components/ui`.' } } },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Share replay' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Share replay' })).toBeDisabled();
  },
};

export const Variants: Story = {
  render: () => (
    <div className="sb-stack">
      {SIZES.map((size) => (
        <section key={size} className="sb-section" aria-label={`${size} buttons`}>
          <h3>{size}</h3>
          <div className="sb-row">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {variant}
              </Button>
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="sb-row">
      <Button size="lg">
        <PlayIcon data-icon="inline-start" aria-hidden="true" />
        Play
      </Button>
      <Button variant="outline" size="lg">
        Export
        <DownloadIcon data-icon="inline-end" aria-hidden="true" />
      </Button>
      <Button variant="destructive" size="icon-lg" aria-label="Delete replay">
        <Trash2Icon aria-hidden="true" />
      </Button>
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="sb-row">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">3 errors</Badge>
    </div>
  ),
};

export const StatusLabels: Story = {
  render: () => (
    <div className="sb-row">
      <StatusLabel tone="success">Passed</StatusLabel>
      <StatusLabel tone="warning">Flaky</StatusLabel>
      <StatusLabel tone="danger" strong>
        Failed
      </StatusLabel>
      <StatusLabel tone="accent">Running</StatusLabel>
      <StatusLabel tone="neutral">Skipped</StatusLabel>
    </div>
  ),
};
