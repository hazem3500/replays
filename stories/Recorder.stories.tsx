import type { Meta, StoryObj } from '@storybook/react-vite';
import { RecorderFixture } from './recorder-fixture.tsx';

const meta = {
  title: 'App/Recorder/Default UI',
  component: RecorderFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RecorderFixture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const IdleAndArmed: Story = {
  args: { mode: 'consent', theme: 'dark' },
  parameters: {
    docs: {
      description: {
        story: 'Idle recorder with the consent prompt armed. The prompt includes the default redaction notice.',
      },
    },
  },
};

export const Recording: Story = {
  args: { mode: 'recording', theme: 'dark' },
  parameters: {
    docs: {
      description: {
        story: 'Recording indicator at a stable 1:13 elapsed time. Select Stop to preview its transition to uploading.',
      },
    },
  },
};

export const Uploading: Story = {
  args: { mode: 'uploading', theme: 'dark' },
  parameters: {
    docs: {
      description: {
        story: 'The default UI upload surface. The API currently presents an indeterminate “Sending…” state.',
      },
    },
  },
};

export const SuccessWithReplayLink: Story = { args: { mode: 'success', theme: 'dark' } };

export const UploadError: Story = { args: { mode: 'error', theme: 'dark' } };

export const CompactMobileWidth: Story = {
  args: { mode: 'recording', theme: 'dark', compact: true },
  parameters: {
    docs: {
      description: {
        story: 'The default UI hosted in a 320px-wide stage to review its compact layout.',
      },
    },
  },
};

export const LightTheme: Story = { args: { mode: 'recording', theme: 'light' } };

export const DarkTheme: Story = { args: { mode: 'recording', theme: 'dark' } };
