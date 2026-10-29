import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { DEFAULT_MESSAGES } from '../../src/recorder/index.ts';
import { DefaultUiStage } from './DefaultUiStage.tsx';
import { inRecorderUi, recorderUi } from './flow.ts';

const meta = {
  title: 'Recorder/Default UI',
  component: DefaultUiStage,
  render: (args, context) => <DefaultUiStage key={`${context.id}:${args.state}:${args.theme}`} {...args} />,
  args: { state: 'consent', theme: 'dark' },
  argTypes: {
    state: { control: 'select', options: ['consent', 'recording', 'uploading', 'sent', 'failed'] },
    theme: { control: 'inline-radio', options: ['dark', 'light'] },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Each surface of `createDefaultUi()` from `@hazem3500/replays/recorder/ui`, driven directly without a recorder. Copy comes from `DEFAULT_MESSAGES`; see Recorder/End to end for the full flow.',
      },
      story: { inline: false, height: '420px' },
    },
  },
} satisfies Meta<typeof DefaultUiStage>;
export default meta;
type Story = StoryObj<typeof meta>;

const visible = (text: string) => inRecorderUi(() => recorderUi.text(text));

export const Consent: Story = {
  play: async () => {
    await visible(DEFAULT_MESSAGES.consentTitle);
    await inRecorderUi(() => recorderUi.button(DEFAULT_MESSAGES.consentAccept));
    await inRecorderUi(() => recorderUi.button(DEFAULT_MESSAGES.consentDecline));
  },
};

export const Recording: Story = {
  args: { state: 'recording' },
  play: async () => {
    await visible('1:13');
    await userEvent.click(await inRecorderUi(() => recorderUi.button(DEFAULT_MESSAGES.stop)));
    await visible(DEFAULT_MESSAGES.uploading);
  },
};

export const Uploading: Story = {
  args: { state: 'uploading' },
  play: async () => {
    await visible(DEFAULT_MESSAGES.uploading);
  },
};

export const Sent: Story = {
  args: { state: 'sent' },
  play: async () => {
    await visible(DEFAULT_MESSAGES.sent);
    const link = await inRecorderUi(() => recorderUi.link('Open replay'));
    await expect(link.href).toBe('https://replays.example/r/demo-42');
  },
};

const showsFailure = async () => {
  await visible(DEFAULT_MESSAGES.failed);
  await inRecorderUi(() => recorderUi.button(DEFAULT_MESSAGES.retry));
  await expect(recorderUi.text('Upload failed with HTTP 503')).toBeUndefined();
};

export const Failed: Story = { args: { state: 'failed' }, play: showsFailure };

export const Light: Story = { args: { state: 'recording', theme: 'light' }, globals: { theme: 'light' } };

export const Phone: Story = {
  args: { state: 'failed' },
  globals: { viewport: { value: 'narrow', isRotated: false } },
  play: showsFailure,
};
