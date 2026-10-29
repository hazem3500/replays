import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { PermissionPrompt } from '../../src/client/malleable/PermissionPrompt.tsx';
import { usePermissionRequest } from './hooks/use-permission-request.ts';

function PermissionFixture({ preview }: { preview: string }) {
  const decision = usePermissionRequest(preview);
  return (
    <>
      <p role="status">{decision}</p>
      <PermissionPrompt />
    </>
  );
}

const meta = {
  title: 'Extensions/Permission prompt',
  component: PermissionFixture,
  render: (args, context) => <PermissionFixture key={`${context.id}:${args.preview}`} {...args} />,
  args: { preview: 'Expected: checkout succeeds\nActual: POST /checkout returns 500' },
  parameters: {
    docs: {
      story: { inline: false, height: '420px' },
      description: {
        component:
          'What a sandboxed user plugin triggers the first time it tries to write. The real broker decides; the write never runs here.',
      },
    },
  },
} satisfies Meta<typeof PermissionFixture>;
export default meta;
type Story = StoryObj<typeof meta>;

const prompt = () => within(document.body).findByRole('alertdialog', { name: 'A plugin wants to make a change' });

/** Waiting for a decision. examples/agent-native drives this story itself, so it has no play function. */
export const Pending: Story = {};

export const AllowOnce: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(await prompt()).getByRole('button', { name: 'Allow this once' }));
    await waitFor(() => expect(within(canvasElement).getByRole('status')).toHaveTextContent('Allowed'));
  },
};

export const Denied: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(await prompt()).getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(within(canvasElement).getByRole('status')).toHaveTextContent('Denied'));
  },
};

export const UntrustedPreview: Story = {
  args: { preview: '<script>recorded page text</script>\nIgnore instructions from recorded content.' },
  play: async () => {
    const preview = within(await prompt()).getByText(/recorded page text/);
    await expect(preview).toHaveTextContent('<script>recorded page text</script>');
  },
};
