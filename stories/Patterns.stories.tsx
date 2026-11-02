import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusLabel } from '../src/client/index/Feed.tsx';
import { CopyButton } from '../src/client/components/copy-button.tsx';
import { Empty } from '../src/client/viewer/Empty.tsx';
import { Toaster } from '../src/client/components/ui/sonner.tsx';
import { toast } from 'sonner';
import { Button } from '../src/client/components/ui/button.tsx';
const meta = {
  title: 'Patterns/Feedback',
  decorators: [
    (Story) => (
      <div className="sb-stage">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const RunStatuses: Story = {
  render: () => (
    <div className="sb-stack">
      {(['running', 'passed', 'failed', 'partial', 'waiting'] as const).map((tone) => (
        <StatusLabel key={tone} tone={tone} label={tone} />
      ))}
    </div>
  ),
};
export const EmptyPanel: Story = {
  render: () => <Empty title="Nothing recorded">No diagnostic events were captured.</Empty>,
};
export const CopyValue: Story = {
  render: () => <CopyButton value="replay-demo-42" label="Copy replay id" />,
};
export const Notifications: Story = {
  render: () => (
    <>
      <Toaster />
      <Button onClick={() => toast.success('Replay link copied')}>Show confirmation</Button>
    </>
  ),
};
