import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { PluginMount } from '../../src/client/plugins/PluginUi.tsx';

type HostContext = { title: string };

const renderHandoff = (container: HTMLElement, context: HostContext) => {
  const line = document.createElement('p');
  line.textContent = `Hand off to ${context.title}`;
  container.append(line);
  return () => line.remove();
};

const broken = (): (() => void) => {
  throw new Error('Fixture plugin failed');
};

const meta = {
  title: 'Extensions/Plugin mount',
  component: PluginMount<HostContext>,
  args: { label: 'Company handoff', render: renderHandoff, context: { title: 'Staging support' } },
  argTypes: { render: { table: { disable: true } } },
  parameters: {
    docs: {
      description: {
        component:
          'How a viewer plugin view mounts: `render(container, context)` runs into a host element and its cleanup runs on unmount. A throwing plugin is contained to one quiet line.',
      },
    },
  },
} satisfies Meta<typeof PluginMount<HostContext>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Rendered: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('Hand off to Staging support')).toBeVisible());
  },
};

export const RenderThrows: Story = {
  args: { render: broken },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('Company handoff could not be shown.')).toBeVisible());
  },
};
