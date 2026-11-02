import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { TitleMorph } from '../src/client/components/title-morph.tsx';

const TITLES = ['Before · Checkout design review', 'After · Checkout design review', 'Run 3 · Checkout validation'] as const;

function TitleChanges() {
  const [selected, setSelected] = useState(0);
  return (
    <section>
      <header className="topbar app-topbar" style={{ maxWidth: 320 }}>
        <h1 className="topbar-title">
          <span className="topbar-title-text">
            <TitleMorph text={TITLES[selected] ?? TITLES[0]} />
          </span>
        </h1>
      </header>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {TITLES.map((title, index) => (
          <button key={title} type="button" onClick={() => setSelected(index)}>
            Run {index + 1}
          </button>
        ))}
      </div>
    </section>
  );
}

const meta = { title: 'Viewer/Title morph', component: TitleChanges } satisfies Meta<typeof TitleChanges>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RunChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const host = canvasElement.querySelector('[data-title-morph]');
    await userEvent.click(canvas.getByRole('button', { name: 'Run 2' }));
    await expect(canvas.getByRole('heading', { name: TITLES[1] })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Run 3' }));
    await expect(canvas.getByRole('heading', { name: TITLES[2] })).toBeVisible();
    await expect(canvasElement.querySelector('[data-title-morph]')).toBe(host);
    await expect(canvas.queryByRole('heading', { name: TITLES[0] })).toBeNull();
  },
};
