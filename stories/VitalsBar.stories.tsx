import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { Vital } from '../src/client/viewer/performance/model.ts';
import { VitalsBar, type VitalPeer } from '../src/client/viewer/performance/VitalsBar.tsx';
// oxlint-disable-next-line import/no-unassigned-import -- why: isolated vitals stories need the lazy performance panel's styles.
import '../src/client/viewer/performance/performance.css';

const vitals: Vital[] = [
  { id: 'fcp', value: 540, verdict: 'good', at: 540 },
  { id: 'lcp', value: 880, verdict: 'good', at: 880 },
  { id: 'interaction', value: 96, verdict: 'good' },
  { id: 'task', value: 62, verdict: 'good' },
  { id: 'tbt', value: 12, verdict: 'good' },
];
const peers: VitalPeer[] = Array.from({ length: 5 }, (_, index) => ({
  id: `run-${index + 2}`,
  name: `Run ${index + 2}`,
  colour: index + 2,
  deltas: { fcp: index === 2 ? -1160 : index === 3 ? 200 : 0, lcp: 0, interaction: 0, task: 0, tbt: 0 },
}));

const meta = {
  title: 'Viewer/Performance vitals',
  component: VitalsBar,
  args: { vitals, peers, onPick: fn() },
} satisfies Meta<typeof VitalsBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SixRecordings: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Same as Run 2')).not.toBeInTheDocument();
    await expect(canvas.getAllByText('Good')).toHaveLength(5);
    await userEvent.click(canvas.getByRole('button', { name: 'First paint 540 ms Good' }));
    await expect(args.onPick).toHaveBeenCalledWith(vitals[0]);
    const trigger = canvas.getByRole('button', { name: 'Compare first paint with 5 recordings' });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    const popup = await page.findByRole('dialog', { name: 'First paint comparison' });
    await expect(within(popup).getByRole('heading', { name: /^First paint comparison$/ })).toBeVisible();
    await expect(within(popup).getByRole('columnheader', { name: 'Change' })).toBeVisible();
    const slowerRun = within(popup).getByRole('row', { name: 'Run 4 1.70 s +1.16 s' });
    await expect(slowerRun).toBeVisible();
    await expect(within(popup).getByRole('row', { name: 'Run 5 340 ms −200 ms' })).toBeVisible();
    await expect(within(popup).getByRole('row', { name: 'Run 2 540 ms Same' })).toBeVisible();
    await expect(popup.querySelectorAll('.pp-delta')).toHaveLength(5);
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
  },
};

export const TwoRecordings: Story = {
  args: { peers: peers.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText('Same as Run 2')).toHaveLength(5);
    await expect(canvas.queryByRole('button', { name: /^Compare / })).not.toBeInTheDocument();
  },
};

export const MissingPeerMeasurements: Story = {
  args: { peers: peers.map((peer) => ({ ...peer, deltas: {} })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText('Good')).toHaveLength(5);
    await expect(canvas.queryByRole('button', { name: /^Compare / })).not.toBeInTheDocument();
  },
};
