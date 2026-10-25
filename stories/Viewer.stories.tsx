import type { Meta, StoryObj } from '@storybook/react-vite';
import { ViewerSkeleton } from '../src/client/ViewerSkeleton.tsx';
import { ContextPanel } from '../src/client/viewer/ContextPanel.tsx';
import { PluginMount } from '../src/client/plugins/PluginUi.tsx';
import { SourceLead } from '../src/client/index/SourceLine.tsx';
import type { ReplayBundle } from '../src/shared/replay.ts';

const meta = { title: 'Viewer/States', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { render: () => <ViewerSkeleton /> };
export const LoadingSuite: Story = { render: () => <ViewerSkeleton suite label="Loading review suite" /> };

const bundle = {
  meta: {
    id: 'storybook',
    title: 'Checkout failures',
    capturedAt: '2026-10-25T10:00:00Z',
    version: 1,
    url: 'https://example.com/checkout',
    duration: 12000,
    viewport: { width: 1280, height: 800 },
    eventCount: 0,
  },
  context: {
    version: 1,
    capturedAt: '2026-10-25T10:00:00Z',
    app: { name: 'Example host', environment: 'staging' },
    fields: { environment: 'staging', release: 'v1.2.3', customerSession: false },
    sources: [{ provider: 'github', ref: 'example/shop#42', url: 'https://github.com/example/shop/pull/42', label: 'Checkout fix' }],
  },
} satisfies Pick<ReplayBundle, 'meta' | 'context'>;

export const HostContext: Story = {
  render: () => (
    <div style={{ height: 500 }}>
      <ContextPanel
        bundle={bundle}
        schema={{
          type: 'object',
          properties: {
            environment: { type: 'string', title: 'Environment' },
            release: { type: 'string', title: 'Release' },
            customerSession: { type: 'boolean', title: 'Customer session' },
          },
        }}
      />
    </div>
  ),
};
export const EmptyContext: Story = { render: () => <ContextPanel bundle={{ meta: bundle.meta }} /> };
export const SourceLinks: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      <SourceLead sources={bundle.context!.sources} origin="agent" />
    </div>
  ),
};

const renderHost = (container: HTMLElement, context: { title: string }) => {
  const line = document.createElement('p');
  line.textContent = context.title;
  container.append(line);
  return () => line.remove();
};
export const HostPlugin: Story = {
  render: () => <PluginMount label="Company handoff" render={renderHost} context={{ title: 'Staging · reviewer@example.com' }} />,
};
const broken = () => {
  throw new Error('Fixture plugin failed');
};
export const PluginError: Story = { render: () => <PluginMount label="Company handoff" render={broken} context={{}} /> };
