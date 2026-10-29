import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SettingsDialog, type SettingsSectionId } from '../../src/client/settings/Settings.tsx';
import { strings } from '../../src/client/settings/strings.ts';
import { agentCredentials, config, configFails, configPending } from '../mocks/api.ts';

function SettingsPage({ section }: { section: SettingsSectionId }) {
  const [open, setOpen] = useState(true);
  const [current, setCurrent] = useState(section);
  return <SettingsDialog open={open} onOpenChange={setOpen} section={current} onSectionChange={setCurrent} />;
}

const meta = {
  title: 'App/Settings',
  component: SettingsPage,
  render: (args, context) => <SettingsPage key={`${context.id}:${args.section}`} {...args} />,
  args: { section: 'cli' },
  argTypes: { section: { control: 'select', options: ['cli', 'keyboard', 'labs', 'about'] } },
  parameters: {
    layout: 'fullscreen',
    network: { handlers: [config(), ...agentCredentials([{ id: 'ci', name: 'CI reviewer' }])] },
    docs: { story: { inline: false, height: '640px' } },
  },
} satisfies Meta<typeof SettingsPage>;
export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () => within(document.body).findByRole('dialog', { name: strings.title });

export const CliAndAgents: Story = {
  play: async () => {
    const settings = within(await dialog());
    await waitFor(() => expect(settings.getByText('CI reviewer')).toBeVisible(), { timeout: 5000 });
  },
};

export const CliLoading: Story = {
  parameters: { network: { handlers: [configPending()] } },
  play: async () => {
    await expect(within(await dialog()).getByRole('status')).toHaveTextContent(strings.cli.loading);
  },
};

export const CliLoadFailed: Story = {
  parameters: { network: { handlers: [configFails()] } },
  play: async () => {
    const alert = await within(await dialog()).findByRole('alert');
    await expect(alert).toHaveTextContent(strings.cli.loadFailed);
    await expect(within(alert).getByRole('button', { name: strings.cli.retry })).toBeVisible();
  },
};

/** The keyboard pane scrolls without a focusable element, which axe reports (scrollable-region-focusable). */
const scrollsWithoutFocus = { a11y: { test: 'todo' } } as const;

export const Keyboard: Story = { args: { section: 'keyboard' }, parameters: scrollsWithoutFocus };

export const Labs: Story = { args: { section: 'labs' } };

export const About: Story = { args: { section: 'about' } };

export const SwitchSections: Story = {
  parameters: scrollsWithoutFocus,
  play: async () => {
    const settings = within(await dialog());
    await userEvent.click(settings.getByRole('tab', { name: strings.sections.keyboard }));
    await waitFor(() => expect(settings.getByText(strings.keyboard.intro)).toBeVisible());
  },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  args: { section: 'keyboard' },
  parameters: scrollsWithoutFocus,
};

export const LightPhone: Story = {
  globals: { theme: 'light', viewport: { value: 'phone', isRotated: false } },
  args: { section: 'about' },
};
