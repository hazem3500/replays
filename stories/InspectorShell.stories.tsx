import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageSquareIcon } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { DockPanel, InspectorDock } from '../src/client/viewer/InspectorDock.tsx';
import { inspectorTabItems } from '../src/client/viewer/inspector-tabs.ts';
import { PanelPending } from '../src/client/viewer/PanelPending.tsx';

const meta = { title: 'Viewer/Inspector shell', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const items = (rail: boolean) =>
  inspectorTabItems({
    stepCount: 6,
    rail,
    badges: {
      console: { value: 2, tone: 'warning', label: '2 entries, 1 warning' },
      network: { value: 8, tone: 'danger', label: '8 requests, 1 failed' },
      performance: { value: 4, label: '4 signals' },
    },
    features: [{ id: 'comments', label: 'Comments', Icon: MessageSquareIcon, badge: { value: 2, label: '2' } }],
  });

function Dock({ rail, ready }: { rail: boolean; ready: boolean }) {
  const [tab, setTab] = useState('network');
  const [collapsed, setCollapsed] = useState(false);
  const tabs = items(rail);
  return (
    <div style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
      <InspectorDock
        items={tabs}
        tab={tab}
        onTabChange={setTab}
        fold={{ collapsed, onCollapsedChange: setCollapsed }}
        compact={!rail}
        ready={ready}
      >
        {tabs.map((item) => (
          <DockPanel key={item.id} value={item.id}>
            <p style={{ padding: 16 }}>{item.label} rows</p>
          </DockPanel>
        ))}
      </InspectorDock>
    </div>
  );
}

export const TabRow: Story = {
  render: () => <Dock rail ready />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Network, 8 requests, 1 failed' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.queryByRole('tab', { name: /^Steps/ })).toBeNull();
    await userEvent.click(canvas.getByRole('tab', { name: 'Console, 2 entries, 1 warning' }));
    await expect(canvas.getByText('Console rows')).toBeVisible();
  },
};

export const PhoneTabRow: Story = {
  render: () => <Dock rail={false} ready />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('tab')[0]).toHaveAccessibleName('Steps, 6 steps');
  },
};

export const PanelsPending: Story = {
  render: () => <Dock rail ready={false} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Loading requests');
  },
};

export const PendingFrames: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, padding: 16 }}>
      {['console', 'network', 'performance', 'context', 'steps'].map((panel) => (
        <div key={panel} style={{ height: 220, display: 'flex', flexDirection: 'column', border: '1px solid var(--line)' }}>
          <PanelPending panel={panel} />
        </div>
      ))}
    </div>
  ),
};
