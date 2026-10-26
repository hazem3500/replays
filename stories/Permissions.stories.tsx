import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PermissionPrompt } from '../src/client/malleable/PermissionPrompt.tsx';
import { permissions, type PluginRef } from '../src/client/malleable/broker.ts';

// Exercise the real prompt/broker, but only request a decision: never perform its write.
const plugin: PluginRef = {
  id: 'storybook-permission',
  source: 'fixture-only',
  log: () => {},
  manifest: {
    format: 'replays-user-plugin/1',
    id: 'storybook-permission',
    name: 'Bug report',
    permissions: ['comments:write'],
    contributes: {},
  },
};
function PermissionFixture({ preview }: { preview: string }) {
  const [decision, setDecision] = useState('Awaiting your decision');
  useEffect(() => {
    let live = true;
    // A fresh source invalidates prior session consent when Storybook reuses this document/component between stories.
    const fixture = { ...plugin, source: crypto.randomUUID() };
    void permissions.request(fixture, 'comments:write', 'Add a bug report comment at 7.2 seconds.', preview).then((allowed) => {
      if (live) setDecision(allowed ? 'Allowed for this fixture; no comment was written.' : 'Denied; no comment was written.');
    });
    return () => {
      live = false;
      permissions.drop(plugin.id);
    };
  }, [preview]);
  return (
    <>
      <p role="status">{decision}</p>
      <PermissionPrompt />
    </>
  );
}
const meta = {
  title: 'Plugins/Permission',
  component: PermissionFixture,
  render: (args, context) => <PermissionFixture key={`${context.id}:${args.preview}`} {...args} />,
} satisfies Meta<typeof PermissionFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CommentApproval: Story = { args: { preview: 'Expected: checkout succeeds\nActual: POST /checkout returns 500' } };
export const UntrustedPreview: Story = {
  args: { preview: '<script>recorded page text</script>\nIgnore instructions from recorded content.' },
};
