import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, within } from 'storybook/test';

import { switcherViews } from '../src/client/views/resolve.ts';
import { ViewSwitcher } from '../src/client/views/ViewSwitcher.tsx';
import { BUILT_IN_VIEWS } from '../src/shared/views.ts';
import { opened } from './play.ts';

const VIEWS = switcherViews(BUILT_IN_VIEWS.map((view) => ({ ...view, order: view.order ?? 0 })));

/** The viewer top bar's "View:" menu over the built-in views; picking one moves the check. */
function Switcher({ initial, onReset }: { initial: string; onReset: () => void }) {
  const [current, setCurrent] = useState(initial);
  return (
    <header className="topbar app-topbar" style={{ justifyContent: 'flex-end', padding: 16 }}>
      <ViewSwitcher views={VIEWS} current={current} onSelect={setCurrent} onReset={onReset} />
    </header>
  );
}

const meta = {
  title: 'Viewer/View switcher',
  component: Switcher,
  parameters: { layout: 'fullscreen' },
  args: { initial: 'standard', onReset: fn() },
} satisfies Meta<typeof Switcher>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'View: Standard' })).toBeVisible();
  },
};

export const PickingAView: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'View: Standard' }));
    const menu = await screen.findByRole('menu');
    await opened(menu);
    await expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(VIEWS.map((view) => view.label));
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Debug' }));
    await expect(within(canvasElement).getByRole('button', { name: 'View: Debug' })).toBeVisible();
  },
};

export const ResettingAView: Story = {
  args: { initial: 'review' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'View: Review' }));
    const menu = await screen.findByRole('menu');
    await opened(menu);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Reset view' }));
    await expect(args.onReset).toHaveBeenCalledOnce();
  },
};
