import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { defaultRecorderMessages } from '../../src/recorder/index.ts';
import { DefaultUiStage, type DefaultUiStageProps } from './DefaultUiStage.tsx';
import { inRecorderUi, recorderUi, resultCopy } from './flow.ts';

const meta = {
  title: 'Recorder/Default UI',
  component: DefaultUiStage,
  render: (args, context) => <DefaultUiStage key={`${context.id}:${args.state}:${args.theme}:${args.palette}:${args.actions}`} {...args} />,
  args: { state: 'consent', theme: 'dark', palette: 'replays', actions: 'default' },
  argTypes: {
    state: {
      control: 'select',
      options: ['options', 'options-capped', 'consent', 'recording', 'final-seconds', 'review', 'uploading', 'sent', 'failed'],
    },
    theme: { control: 'inline-radio', options: ['dark', 'light'] },
    palette: { control: 'inline-radio', options: ['replays', 'host'] },
    actions: { control: 'inline-radio', options: ['default', 'copy-only'] },
    copy: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Each surface of `createDefaultUi()` from `@hazem3500/replays/recorder/ui`, driven directly without a recorder. Copy comes from `defaultRecorderMessages`; see Recorder/End to end for the full flow.',
      },
      story: { inline: false, height: '420px' },
    },
  },
} satisfies Meta<typeof DefaultUiStage>;
export default meta;
type Story = StoryObj<typeof meta>;

const visible = (text: string) => inRecorderUi(() => recorderUi.text(text));
const openMenu = async () => {
  const trigger = await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.optionsTitle));
  await userEvent.click(trigger);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
};

/** The opt-in options step (`choices` on an internal host): the recording pill's Record, a quiet options button and close. */
export const Options: Story = {
  args: { state: 'options' },
  play: async () => {
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.record));
    const options = await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.optionsTitle));
    await expect(options).toHaveAttribute('title', 'Masked · Triage');
  },
};

/** The options menu: a Profile group with each profile's description, then Privacy with what each mode records. */
export const OptionsMenuOpen: Story = {
  args: { state: 'options' },
  play: async () => {
    await openMenu();
    await inRecorderUi(() => recorderUi.item('Support'));
    await visible('Slow pages, with vitals and requests');
    await visible('Hides text, inputs and media');
    await visible(defaultRecorderMessages.privacyAlways);
  },
};

/** A host that keeps media blocked: Visible is capped to its privacy, and Text masked is disabled. */
export const OptionsCapped: Story = {
  args: { state: 'options-capped' },
  play: async () => {
    await openMenu();
    const textMasked = await inRecorderUi(() => recorderUi.item('Text masked'));
    await expect(textMasked).toHaveAttribute('aria-disabled', 'true');
    await visible(defaultRecorderMessages.privacyUnavailable);
  },
};

export const OptionsLight: Story = {
  args: { state: 'options', theme: 'light' },
  globals: { theme: 'light' },
  play: openMenu,
};

/** On phones the menu is a full-width sheet above the pill. */
export const OptionsPhone: Story = {
  args: { state: 'options' },
  globals: { viewport: { value: 'narrow', isRotated: false } },
  play: openMenu,
};

export const Consent: Story = {
  play: async () => {
    await visible(defaultRecorderMessages.consentTitle);
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.consentAccept));
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.consentDecline));
  },
};

export const Recording: Story = {
  args: { state: 'recording' },
  play: async () => {
    await visible('1:13');
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.stop));
  },
};

export const Uploading: Story = {
  args: { state: 'uploading' },
  play: async () => {
    await visible(defaultRecorderMessages.uploading);
  },
};

export const Sent: Story = {
  args: { state: 'sent' },
  play: async () => {
    await visible(resultCopy.sent);
    const open = await inRecorderUi(() => recorderUi.link(defaultRecorderMessages.openLink));
    await expect(open.href).toBe('https://replays.example/r/demo-42');
    await expect(open.rel).toBe('noopener noreferrer');
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.copyLink));
  },
};

/** A customer-facing host that passes its own `completion.actions`: copy only, no Open. */
export const SentCopyOnly: Story = {
  args: { state: 'sent', actions: 'copy-only' },
  play: async () => {
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.copyLink));
    await expect(recorderUi.text(defaultRecorderMessages.openLink)).toBeUndefined();
  },
};

/** The last 10 seconds before the time limit: the timer turns red. */
export const FinalSeconds: Story = {
  args: { state: 'final-seconds' },
  play: async () => {
    await visible('2:54');
  },
};

export const Review: Story = {
  args: { state: 'review' },
  play: async () => {
    await visible(defaultRecorderMessages.reviewTitle);
    await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.send));
  },
};

/** A host design system's palette, font radius and red mapped onto the `--recorder-*` tokens. */
export const HostThemed: Story = { args: { state: 'recording', palette: 'host' } };

export const HostThemedLight: Story = { args: { state: 'sent', palette: 'host', theme: 'light' }, globals: { theme: 'light' } };

const showsFailure = async () => {
  await visible(resultCopy.failed);
  await inRecorderUi(() => recorderUi.button(defaultRecorderMessages.retry));
  await expect(recorderUi.text('Upload failed with HTTP 503')).toBeUndefined();
};

export const Failed: Story = { args: { state: 'failed' }, play: showsFailure };

export const Light: Story = { args: { state: 'recording', theme: 'light' }, globals: { theme: 'light' } };

export const Phone: Story = {
  args: { state: 'failed' },
  globals: { viewport: { value: 'narrow', isRotated: false } },
  play: showsFailure,
};

const german: DefaultUiStageProps['copy'] = {
  locale: 'de',
  messages: {
    consentTitle: 'Diesen Tab aufzeichnen?',
    consentBody: ({ limit }) => `Bis zu ${limit}. Jederzeit beenden.`,
    consentPrivacy: 'Seitentext und Eingaben werden maskiert.',
    consentAccept: 'Aufnahme starten',
    consentDecline: 'Nicht jetzt',
    recording: 'Aufnahme',
    stop: 'Beenden',
    uploading: 'Wird gesendet…',
    sent: ({ reference }) => `Aufnahme gesendet (${reference})`,
    failed: 'Senden fehlgeschlagen',
    retry: 'Erneut versuchen',
    close: 'Schließen',
  },
  format: { elapsed: (ms) => `${Math.round(ms / 1000)} s` },
};

/** A host's translations through `messages`, `locale` and a `format` hook; `consentPrivacy` and `failed` use the plain string form. */
export const Translated: Story = {
  args: { copy: german },
  play: async () => {
    await visible('Diesen Tab aufzeichnen?');
    await visible('Bis zu 3 Minuten. Jederzeit beenden.');
    await inRecorderUi(() => recorderUi.button('Aufnahme starten'));
  },
};

export const TranslatedRecording: Story = {
  args: { state: 'recording', copy: german },
  play: async () => {
    await visible('73 s');
    await inRecorderUi(() => recorderUi.button('Beenden'));
  },
};

export const TranslatedSent: Story = {
  args: { state: 'sent', copy: german },
  play: async () => {
    await visible('Aufnahme gesendet (SUP-2042)');
  },
};
