import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { ConsolePanel, ConsolePending } from '../src/client/viewer/console/ConsolePanel.tsx';
import type { ReplayBundle, ReplayConsoleEntry } from '../src/shared/replay.ts';
import { PanelFrame, storyBundle } from './netperf-fixture.tsx';

const meta = { title: 'Viewer/Console', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const page = 'https://shop.pinecone.demo.test/checkout';
const entries: ReplayConsoleEntry[] = [
  { at: 300, level: 'info', message: 'App booted in 142 ms', url: page },
  { at: 900, level: 'debug', message: 'feature flags {"checkoutV2":true,"recommendations":{"variant":"b"}}', url: page },
  { at: 1400, level: 'log', message: 'poll: 0 new notifications', url: page },
  { at: 1800, level: 'log', message: 'poll: 0 new notifications', url: page },
  { at: 2200, level: 'log', message: 'poll: 0 new notifications', url: page },
  {
    at: 3000,
    level: 'log',
    message: 'cart updated {"items":[{"sku":"tea-01","qty":1},{"sku":"mug-02","qty":1}],"subtotal":38}',
    url: page,
  },
  {
    at: 4600,
    level: 'warn',
    message: 'Shipping options took 1.8 s; falling back to the cached list, which may be up to 24 hours old.',
    url: page,
  },
  {
    at: 5200,
    level: 'error',
    message:
      "TypeError: Cannot read properties of undefined (reading 'total')\n    at renderSummary (https://shop.pinecone.demo.test/app.js:212:31)\n    at Array.forEach (<anonymous>)",
    url: page,
  },
  { at: 8700, level: 'info', message: 'Order placed\nid: ord_5521\nitems: 2\ntotal: $38.00', url: page },
];

const busy: ReplayBundle = { ...storyBundle([]), console: entries };
const quiet: ReplayBundle = storyBundle([]);

function Console({ bundle, width }: { bundle: ReplayBundle; width?: number }) {
  return (
    <PanelFrame bundle={bundle} {...(width ? { width } : {})}>
      <ConsolePanel entries={bundle.console} human={false} />
    </PanelFrame>
  );
}

export const Messages: Story = {
  render: () => <Console bundle={busy} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('×3')).toBeVisible();
    await userEvent.click(canvas.getByText(/TypeError/));
    await expect(canvas.getByTestId('console-detail')).toHaveTextContent('renderSummary');
  },
};

export const Filtered: Story = {
  render: () => <Console bundle={busy} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('console-level-error'));
    await expect(canvasElement.querySelectorAll('[data-console-id]')).toHaveLength(1);
  },
};

export const Phone: Story = { render: () => <Console bundle={busy} width={390} /> };

export const Empty: Story = { render: () => <Console bundle={quiet} /> };

export const Loading: Story = { render: () => <PanelFrame bundle={quiet}>{ConsolePending}</PanelFrame> };
