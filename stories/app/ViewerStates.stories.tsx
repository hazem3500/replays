import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { meQuery, queryClient } from '../../src/client/queries.ts';
import { ViewerSkeleton } from '../../src/client/ViewerSkeleton.tsx';
import { ContextPanel } from '../../src/client/viewer/ContextPanel.tsx';
import { SourceLead } from '../../src/client/index/SourceLine.tsx';
import type { ReplayBundle } from '../../src/shared/replay.ts';

const meta = {
  title: 'App/Viewer/States',
  // why: the loading top bar is the real Topbar, whose account menu would ask /api/me; these states are signed out.
  beforeEach: () => {
    queryClient.setQueryData(meQuery.queryKey, null);
  },
  parameters: {
    docs: {
      description: {
        component:
          'Stable viewer pieces. The viewer shell, inspector and compare views are being redesigned; their owners add stories with those changes.',
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <ViewerSkeleton />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Loading replay')).toBeVisible();
  },
};

export const LoadingPhone: Story = {
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => <ViewerSkeleton />,
};

export const LoadingSuite: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <ViewerSkeleton suite label="Loading review suite" />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('.sk-run')).toHaveLength(3);
    await expect(canvasElement.querySelector('.sk-layout-switch')).not.toBeNull();
  },
};

export const LoadingSuiteGrid: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <ViewerSkeleton label="Loading runs" comparing={4} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('.sk-tile')).toHaveLength(4);
  },
};

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

const panel = { maxWidth: 420, height: 520 };

export const HostContext: Story = {
  render: () => (
    <div className="sb-panel" style={panel}>
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
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('v1.2.3')).toBeVisible();
  },
};

export const EmptyContext: Story = {
  render: () => (
    <div className="sb-panel" style={panel}>
      <ContextPanel bundle={{ meta: bundle.meta }} />
    </div>
  ),
};

export const SourceLinks: Story = {
  render: () => <SourceLead sources={bundle.context.sources} origin="agent" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: /example\/shop#42|Checkout fix/ })).toHaveAttribute(
      'href',
      'https://github.com/example/shop/pull/42',
    );
  },
};
