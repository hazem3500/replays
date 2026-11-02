import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SettingsButton } from '../src/client/settings/Settings.tsx';
import { AgentCredentials } from '../src/client/settings/AgentCredentials.tsx';
const meta = {
  title: 'App/Settings/Access',
  beforeEach: () => async () => {
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]');
    if (close) {
      close.click();
      await waitFor(() => expect(document.querySelector('[aria-label="Close settings"]')).toBeNull());
    }
  },
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
const openSettings = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  if (!within(canvasElement.ownerDocument.body).queryByRole('dialog'))
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Settings' }));
  await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByRole('dialog')).toBeVisible());
  // Enter transitions temporarily blend the text and backdrop; audit the finished surface.
  await Promise.all(
    canvasElement.ownerDocument
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})),
  );
};
const renderSettings: NonNullable<Story['render']> = (_args, context) => <SettingsButton key={context.id} />;
export const Settings: Story = { render: renderSettings, play: openSettings };
export const SettingsMobile: Story = {
  render: renderSettings,
  play: openSettings,
  globals: { viewport: { value: 'mobile390', isRotated: false } },
};
export const SettingsError: Story = {
  render: renderSettings,
  play: openSettings,
  parameters: { api: { state: 'error' } },
};
export const SettingsLoading: Story = {
  render: renderSettings,
  play: openSettings,
  parameters: { api: { state: 'loading' } },
};
export const CredentialsEmpty: Story = { render: () => <AgentCredentials /> };
export const CredentialsPopulated: Story = {
  ...CredentialsEmpty,
  parameters: { api: { credentials: true } },
};
export const CredentialsOverflow: Story = {
  ...CredentialsEmpty,
  parameters: { api: { state: 'dense', credentials: true } },
};
export const CredentialsLoading: Story = {
  ...CredentialsEmpty,
  parameters: { api: { state: 'loading' } },
};
export const CredentialsError: Story = {
  ...CredentialsEmpty,
  parameters: { api: { state: 'error' } },
};
export const CredentialsUnavailable: Story = {
  ...CredentialsEmpty,
  parameters: { api: { state: 'unavailable' } },
};
export const CredentialsSignIn: Story = {
  ...CredentialsEmpty,
  parameters: { api: { state: 'signin' } },
};
export const Light: Story = {
  render: renderSettings,
  play: openSettings,
  globals: { theme: 'light' },
};
