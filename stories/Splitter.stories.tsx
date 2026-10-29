import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Splitter } from '../src/client/components/ui/splitter.tsx';

const meta = { title: 'UI/Splitter', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Split() {
  const [height, setHeight] = useState(200);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ height: 480, display: 'grid', gridTemplateRows: `minmax(0, 1fr) auto ${collapsed ? 36 : height}px` }}>
      <div style={{ padding: 16 }}>Player</div>
      <Splitter
        orientation="horizontal"
        side="end"
        value={height}
        min={120}
        max={360}
        defaultValue={200}
        snapPoints={[200]}
        collapsible
        collapsed={collapsed}
        onChange={setHeight}
        onCollapsedChange={setCollapsed}
        label="Resize panel"
      />
      <div style={{ padding: 16, background: 'var(--surface-raised)' }}>Panel</div>
    </div>
  );
}

export const Horizontal: Story = {
  render: () => <Split />,
  play: async ({ canvasElement }) => {
    const seam = within(canvasElement).getByRole('separator', { name: 'Resize panel' });
    await userEvent.click(seam);
    await userEvent.keyboard('{ArrowUp}');
    await expect(seam).toHaveAttribute('aria-valuenow', '216');
    await userEvent.keyboard('{Enter}');
    await expect(seam).toHaveAttribute('aria-valuenow', '0');
    await userEvent.keyboard('{Enter}');
    await expect(seam).toHaveAttribute('aria-valuenow', '216');
  },
};
