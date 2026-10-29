import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { buildNetworkRows } from '../src/client/viewer/network/model.ts';
import { NetworkPanel, NetworkPending, type NetworkPeer } from '../src/client/viewer/network/NetworkPanel.tsx';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import { vitalsOf } from '../src/client/viewer/performance/model.ts';
import { PerformancePanel } from '../src/client/viewer/performance/PerformancePanel.tsx';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { busyNetwork, PanelFrame, PERFORMANCE, SPARSE, STEPS, storyBundle } from './netperf-fixture.tsx';

const meta = { title: 'Viewer/Network and Performance', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const busy = storyBundle(busyNetwork(), PERFORMANCE);
const sparse = storyBundle(SPARSE);
const quiet = storyBundle([], []);
const before = storyBundle(
  SPARSE.map((entry) => (entry.id === 'coupon' ? { ...entry, status: 200, statusText: 'OK', duration: 96 } : entry)),
  [
    { at: 196, kind: 'first-contentful-paint', value: 240 },
    { at: 9900, kind: 'slow-interaction', value: 120, eventType: 'click' },
  ],
);

function Network({ bundle, width, open, peers }: { bundle: ReplayBundle; width?: number; open?: string; peers?: NetworkPeer[] }) {
  const [selected, setSelected] = useState(open);
  return (
    <PanelFrame bundle={bundle} {...(width ? { width } : {})}>
      <NetworkPanel
        rows={buildNetworkRows(bundle)}
        steps={STEPS}
        duration={bundle.meta.duration}
        human={false}
        selected={selected}
        onSelect={setSelected}
        peers={peers}
      />
    </PanelFrame>
  );
}

function Performance({ bundle, width, compare }: { bundle: ReplayBundle; width?: number; compare?: boolean }) {
  return (
    <PanelFrame bundle={bundle} {...(width ? { width } : {})}>
      <PerformancePanel
        model={buildPerformance(bundle)}
        requests={buildNetworkRows(bundle)}
        steps={STEPS}
        duration={bundle.meta.duration}
        peers={compare ? [{ id: 'before', name: 'Before', colour: 1, vitals: vitalsOf(before) }] : []}
        onOpenRequest={() => {}}
      />
    </PanelFrame>
  );
}

export const NetworkBusy: Story = {
  render: () => <Network bundle={busy} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('network-ribbon')).toBeVisible();
    await userEvent.click(canvas.getByTestId('network-status-failed'));
    await expect(canvas.getByText(/^\d+ requests$/)).toBeVisible();
  },
};

export const NetworkSparse: Story = {
  render: () => <Network bundle={sparse} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('network-ribbon')).toBeNull();
    await expect(canvas.getAllByRole('row')).toHaveLength(4);
  },
};

export const NetworkFailedOpen: Story = {
  render: () => <Network bundle={sparse} open="coupon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const detail = canvas.getByTestId('request-detail');
    await expect(detail).toHaveTextContent('Unprocessable Entity');
    await userEvent.keyboard('{Escape}');
  },
};

export const NetworkCompared: Story = {
  render: () => (
    <Network
      bundle={sparse}
      open="coupon"
      peers={[{ id: 'before', name: 'Before', colour: 1, label: 'Before the fix', rows: buildNetworkRows(before) }]}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'In the other recordings' })).toHaveTextContent('200');
  },
};

export const NetworkPhone: Story = { render: () => <Network bundle={busy} width={390} open="coupon" /> };

export const NetworkEmpty: Story = { render: () => <Network bundle={quiet} /> };

export const NetworkLoading: Story = { render: () => <PanelFrame bundle={quiet}>{NetworkPending}</PanelFrame> };

export const PerformanceMoments: Story = {
  render: () => <Performance bundle={busy} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getByTestId('performance-events').querySelectorAll('[data-performance-id]');
    await expect(rows[0]).toHaveTextContent('Long task');
    await userEvent.click(canvas.getByRole('button', { name: 'In order' }));
    await expect(canvas.getByRole('button', { name: 'In order' })).toHaveAttribute('aria-pressed', 'true');
  },
};

export const PerformanceCompared: Story = {
  render: () => <Performance bundle={busy} compare />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('performance-vitals')).toHaveTextContent('vs B');
  },
};

export const PerformancePhone: Story = { render: () => <Performance bundle={busy} width={390} /> };

export const PerformanceNotCaptured: Story = { render: () => <Performance bundle={sparse} /> };

export const PerformanceCalm: Story = { render: () => <Performance bundle={quiet} /> };
