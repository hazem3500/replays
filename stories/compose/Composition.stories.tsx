// oxlint-disable-next-line import/no-unassigned-import -- why: independent hosts explicitly opt into the replay stage stylesheet.
import '../../src/client/compose/stage.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ReplayInspector, ReplayProvider, ReplayStage, ReplaySteps, ReplayTransport } from '../../src/client/compose/index.ts';
import { compositionRecording } from './fixture.ts';

const meta = {
  title: 'Public API/React composition',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const recording = compositionRecording('Checkout recording');
const replacement = compositionRecording('Replacement recording');
const emptyRecording = compositionRecording('Recording without diagnostics', false);

function Diagnostics() {
  return (
    <ReplayInspector>
      {(model) => (
        <section aria-label="Host diagnostics">
          <h3>Diagnostics</h3>
          <p>
            {model.console.length} console entries, {model.network.length} requests
          </p>
          {model.errors.length ? (
            <ul>
              {model.errors.map((issue) => (
                <li key={`${issue.kind}:${issue.at}:${issue.label}`}>
                  <button type="button" onClick={() => model.seek(issue.at)}>
                    {issue.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No captured errors</p>
          )}
        </section>
      )}
    </ReplayInspector>
  );
}

function DefaultComposition() {
  return (
    <ReplayProvider bundle={recording}>
      <div style={{ maxWidth: 560, display: 'grid', gap: 16 }}>
        <ReplayStage aria-label="Recorded checkout" />
        <ReplayTransport />
        <ReplaySteps />
        <Diagnostics />
      </div>
    </ReplayProvider>
  );
}

export const IndependentlyPlacedPrimitives: Story = {
  render: () => <DefaultComposition />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Review order/ }));
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveValue('2000');
    await expect(canvas.getByRole('button', { name: /Review order/ })).toHaveAttribute('aria-current', 'step');
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Playback speed' }), '2');
    await expect(canvas.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('2');
    await userEvent.click(canvas.getByRole('button', { name: 'Console error: Payment declined' }));
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveValue('3500');
  },
};

function CustomPane({ name }: { name: string }) {
  return (
    <section aria-label={name} style={{ minWidth: 0, display: 'grid', alignContent: 'start', gap: 12 }}>
      <h2>{name}</h2>
      <ReplayProvider bundle={recording}>
        <ReplayStage aria-label={`${name} picture`} />
        <ReplayTransport>
          {({ playback, time, state }) => (
            <div role="group" aria-label="Host transport" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={playback.playPause}>
                {state.status === 'playing' ? 'Pause' : 'Play'}
              </button>
              <button type="button" onClick={() => playback.seek(1000)}>
                Seek to one second
              </button>
              <button type="button" onClick={() => playback.setSpeed(state.speed === 1 ? 2 : 1)}>
                {state.speed}×
              </button>
              <output aria-label="Host time">{time}</output>
            </div>
          )}
        </ReplayTransport>
        <ReplaySteps>
          {({ steps, activeIndex, select }) => (
            <nav aria-label="Host chapters">
              {steps.map((step, index) => (
                <button
                  key={`${step.at}:${step.label}`}
                  type="button"
                  aria-current={index === activeIndex ? 'step' : undefined}
                  onClick={() => select(index)}
                >
                  {step.label}
                </button>
              ))}
            </nav>
          )}
        </ReplaySteps>
        <Diagnostics />
      </ReplayProvider>
    </section>
  );
}

export const TwoIndependentCustomHosts: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 24 }}>
      <CustomPane name="Before" />
      <CustomPane name="After" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const before = within(canvas.getByRole('region', { name: 'Before' }));
    const after = within(canvas.getByRole('region', { name: 'After' }));
    await userEvent.click(before.getByRole('button', { name: 'Seek to one second' }));
    await expect(before.getByRole('status', { name: 'Host time' })).toHaveTextContent('1000');
    await expect(after.getByRole('status', { name: 'Host time' })).toHaveTextContent('0');
    await userEvent.click(before.getByRole('button', { name: '1×' }));
    await expect(before.getByRole('button', { name: '2×' })).toBeVisible();
    await expect(after.getByRole('button', { name: '1×' })).toBeVisible();
    await userEvent.click(after.getByRole('button', { name: 'Review order' }));
    await expect(after.getByRole('status', { name: 'Host time' })).toHaveTextContent('2000');
    await expect(before.getByRole('status', { name: 'Host time' })).toHaveTextContent('1000');
  },
};

function ReplaceableComposition() {
  const [replaced, setReplaced] = useState(false);
  const [mounted, setMounted] = useState(true);
  return (
    <div style={{ maxWidth: 560, display: 'grid', gap: 16 }}>
      <button type="button" onClick={() => setReplaced(true)}>
        Load replacement
      </button>
      <button type="button" onClick={() => setMounted(!mounted)}>
        {mounted ? 'Hide replay' : 'Show replay'}
      </button>
      {mounted ? (
        <ReplayProvider bundle={replaced ? replacement : recording}>
          <ReplayStage aria-label="Replaceable recording" />
          <ReplayTransport />
          <ReplaySteps />
        </ReplayProvider>
      ) : (
        <p>Replay unmounted</p>
      )}
    </div>
  );
}

export const ReplacementAndUnmount: Story = {
  render: () => <ReplaceableComposition />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Review order/ }));
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveValue('2000');
    await userEvent.click(canvas.getByRole('button', { name: 'Load replacement' }));
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveValue('0');
    await userEvent.click(canvas.getByRole('button', { name: 'Hide replay' }));
    await expect(canvas.queryByRole('slider')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Show replay' }));
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveValue('0');
  },
};

export const NoCapturedDiagnostics: Story = {
  render: () => (
    <ReplayProvider bundle={emptyRecording}>
      <div style={{ maxWidth: 560, display: 'grid', gap: 16 }}>
        <ReplayStage aria-label="Recording without diagnostics" />
        <ReplayTransport />
        <ReplaySteps />
        <Diagnostics />
      </div>
    </ReplayProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Host diagnostics' })).toHaveTextContent('No captured errors');
    await expect(within(canvas.getByRole('list', { name: 'Replay steps' })).queryAllByRole('button')).toHaveLength(0);
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveValue('0');
  },
};
