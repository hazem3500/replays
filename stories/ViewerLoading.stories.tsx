import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressiveViewerShell } from '../src/client/ProgressiveViewerShell.tsx';
import { replay } from './fixtures/replays.ts';
function LoadingPanel({ initialPanel }: { initialPanel: string }) {
  const [panel, setPanel] = useState(initialPanel);
  return <ProgressiveViewerShell title="Checkout investigation" activePanel={panel} onPanelChange={setPanel} bundle={replay()} />;
}
const meta = {
  title: 'App/Viewer/Panel loading',
  parameters: { layout: 'fullscreen' },
  component: LoadingPanel,
  args: { initialPanel: 'console' },
} satisfies Meta<typeof LoadingPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Console: Story = {};
export const Network: Story = { args: { initialPanel: 'network' } };
export const Waterfall: Story = { args: { initialPanel: 'waterfall' } };
export const Performance: Story = { args: { initialPanel: 'performance' } };
export const Context: Story = { args: { initialPanel: 'context' } };
export const Mobile: Story = { globals: { viewport: { value: 'mobile390', isRotated: false } } };
export const Light: Story = { globals: { theme: 'light' } };
