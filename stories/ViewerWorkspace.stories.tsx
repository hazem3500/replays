import type { Meta, StoryObj } from '@storybook/react-vite';
import { Viewer } from '../src/client/Viewer.tsx';
import { Topbar, TopbarChip } from '../src/client/Topbar.tsx';
import { Transport } from '../src/client/viewer/Transport.tsx';
import { Scrubber } from '../src/client/viewer/Scrubber.tsx';
import { denseReplay, emptyReplay, replay, samples } from './fixtures/replays.ts';
import { PlayerFixture } from './fixtures/player.tsx';
const meta = {
  title: 'App/Viewer/Workspace',
  component: Viewer,
  parameters: { layout: 'fullscreen', search: 't=999' },
  args: { bundle: replay() },
} satisfies Meta<typeof Viewer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Console: Story = { args: { initialTab: 'console' } };
export const Network: Story = { args: { initialTab: 'network' } };
export const Waterfall: Story = { args: { initialTab: 'waterfall' } };
export const Performance: Story = { args: { initialTab: 'performance' } };
export const Context: Story = { args: { initialTab: 'context' } };
export const ConsoleEmpty: Story = { args: { bundle: emptyReplay(), initialTab: 'console' } };
export const NetworkEmpty: Story = { args: { bundle: emptyReplay(), initialTab: 'network' } };
export const WaterfallEmpty: Story = { args: { bundle: emptyReplay(), initialTab: 'waterfall' } };
export const PerformanceUnsupported: Story = {
  args: { bundle: emptyReplay(), initialTab: 'performance' },
};
export const ContextEmpty: Story = { args: { bundle: emptyReplay(), initialTab: 'context' } };
export const ConsoleDense: Story = { args: { bundle: denseReplay(), initialTab: 'console' } };
export const NetworkDense: Story = { args: { bundle: denseReplay(), initialTab: 'network' } };
export const WaterfallDense: Story = { args: { bundle: denseReplay(), initialTab: 'waterfall' } };
export const PerformanceLongActivity: Story = {
  args: { bundle: samples[3]!, initialTab: 'performance' },
};
export const RecoveredRequest: Story = { args: { bundle: samples[4]!, initialTab: 'network' } };
export const ConsoleWarnings: Story = { args: { bundle: samples[1]!, initialTab: 'console' } };
export const LongTitle: Story = {
  args: {
    title:
      'Checkout regression · international storefront · a very long investigation title that overflows a narrow window and remains readable',
  },
};
export const Mobile: Story = { globals: { viewport: { value: 'mobile390', isRotated: false } } };
export const MobileNetwork: Story = {
  ...Network,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
export const Tablet: Story = { globals: { viewport: { value: 'tablet768', isRotated: false } } };
export const Light: Story = { globals: { theme: 'light' } };
export const TopbarOnly: Story = {
  parameters: { layout: 'padded' },
  render: () => <Topbar title="Checkout investigation" status={<TopbarChip>2 errors</TopbarChip>} />,
};
export const TopbarMobile: Story = {
  parameters: { layout: 'padded' },
  render: () => <Topbar title="A long checkout investigation with multiple reviewers" compact status={<TopbarChip>2 errors</TopbarChip>} />,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
export const TransportOnly: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <PlayerFixture>
      <div className="transport">
        <Transport />
      </div>
    </PlayerFixture>
  ),
};
export const ScrubberWithSteps: Story = {
  parameters: { layout: 'padded' },
  render: () => {
    const bundle = replay();
    return (
      <PlayerFixture bundle={bundle}>
        <div className="sb-stage">
          <Scrubber steps={bundle.steps} errors={[]} />
        </div>
      </PlayerFixture>
    );
  },
};
export const ScrubberEmpty: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <PlayerFixture bundle={emptyReplay()}>
      <div className="sb-stage">
        <Scrubber steps={[]} errors={[]} />
      </div>
    </PlayerFixture>
  ),
};
