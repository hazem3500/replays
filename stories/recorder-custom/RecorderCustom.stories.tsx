import type { Meta, StoryObj } from '@storybook/react-vite';
import { RecorderProvider } from '@hazem3500/replays/recorder/react';
import { RecorderUi } from '../../examples/recorder-shadcn/src/RecorderUi.tsx';

import { useRecorderFixture } from './hooks/fixture.ts';
import type { Mode } from './hooks/fixture.ts';
function RecorderCustom({ mode = 'consent', phone = false }: { mode?: Mode; phone?: boolean }) {
  const fixture = useRecorderFixture(mode);

  return (
    <div style={{ width: phone ? 320 : '100%', minHeight: 400, padding: 24 }}>
      <RecorderProvider recorder={fixture.recorder} deferred={fixture.deferred}>
        <RecorderUi now={fixture.now} />
      </RecorderProvider>
    </div>
  );
}
const meta = {
  title: 'Recorder/Custom UI (kit)',
  component: RecorderCustom,
  parameters: { layout: 'fullscreen' },
  // why: examples/recorder-shadcn ships light-only shadcn tokens; the app's dark tokens would leave its red warning unreadable.
  globals: { theme: 'light' },
} satisfies Meta<typeof RecorderCustom>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Consent: Story = { args: { mode: 'consent' } };
export const Recording: Story = { args: { mode: 'recording' } };
export const Warning: Story = { args: { mode: 'warning' } };
export const FinalWarning: Story = { args: { mode: 'final' } };
export const Uploading40Percent: Story = { args: { mode: 'uploading' } };
export const Sent: Story = { args: { mode: 'sent' } };
export const FailedWithRetry: Story = { args: { mode: 'failed' } };
export const Phone320: Story = {
  args: { mode: 'recording', phone: true },
  globals: { viewport: { value: 'mobile320', isRotated: false } },
};
