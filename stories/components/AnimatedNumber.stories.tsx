import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { AnimatedNumber } from '../../src/client/components/animated-number.tsx';

function Counter({ instant = false }: { instant?: boolean }) {
  const [value, setValue] = useState(9);
  return (
    <section>
      <div style={{ fontSize: 24 }} data-testid="counter">
        <AnimatedNumber value={value} instant={instant} />
      </div>
      <button type="button" onClick={() => setValue(10)}>
        Carry to ten
      </button>
      <button type="button" onClick={() => setValue(-3.5)}>
        Negative decimal
      </button>
      <button type="button" onClick={() => setValue(1234.5678)}>
        Rounded decimal
      </button>
    </section>
  );
}

const meta = { title: 'Components/Animated number', component: Counter } satisfies Meta<typeof Counter>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RollingCounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const plain = canvasElement.querySelector<HTMLElement>('.number-static');
    const overlay = canvasElement.querySelector<HTMLElement>('.number-motion');
    await expect(plain).toHaveTextContent('9');
    await expect(overlay).toBeEmptyDOMElement();
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Carry to ten' }));
    await expect(plain).toHaveTextContent('10');
    await userEvent.click(canvas.getByRole('button', { name: 'Negative decimal' }));
    const formatter = new Intl.NumberFormat(undefined, { useGrouping: false });
    await expect(plain).toHaveTextContent(formatter.format(-3.5));
    await userEvent.click(canvas.getByRole('button', { name: 'Rounded decimal' }));
    await expect(plain).toHaveTextContent(formatter.format(1234.5678));
    await waitFor(() => expect(overlay).toBeEmptyDOMElement());
    const number = canvasElement.querySelector<HTMLElement>('.animated-number');
    await expect(number?.getBoundingClientRect().width).toBe(plain?.getBoundingClientRect().width);
  },
};

export const InstantCounts: Story = {
  args: { instant: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Carry to ten' }));
    await expect(canvasElement.querySelector('.number-static')).toHaveTextContent('10');
    await expect(canvasElement.querySelector('.number-motion')).toBeEmptyDOMElement();
  },
};
