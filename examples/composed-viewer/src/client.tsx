import { useId, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { formatClock, type ReplayBundle } from '@hazem3500/replays/model';
import {
  ReplayInspector,
  ReplayProvider,
  ReplayStage,
  ReplaySteps,
  useReplay,
  useReplayState,
  useReplayTime,
} from '@hazem3500/replays/viewer/react';
// oxlint-disable-next-line import/no-unassigned-import -- why: renderer CSS is explicitly opted into by this host.
import '@hazem3500/replays/viewer/react/style.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: this example owns its page styling independently of Replays.
import './style.css';

import { readRecording } from './load.ts';

function Controls() {
  const { playback } = useReplay();
  const { status, speed } = useReplayState();
  const time = useReplayTime();
  return (
    <div className="controls" role="group" aria-label="Custom playback controls">
      <button type="button" onClick={playback.playPause}>
        {status === 'playing' ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={playback.duration}
        step={1}
        value={time}
        onChange={(event) => playback.seek(event.currentTarget.valueAsNumber)}
      />
      <output>
        {formatClock(time)} / {formatClock(playback.duration)}
      </output>
      <button type="button" onClick={() => playback.setSpeed(speed === 1 ? 2 : 1)}>
        {speed}×
      </button>
    </div>
  );
}

function Pane({ label }: { label: string }) {
  const id = useId();
  const [bundle, setBundle] = useState<ReplayBundle>();
  const [error, setError] = useState('');
  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      setBundle(await readRecording(file));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read the recording.');
    }
  }
  return (
    <section className="pane" aria-label={label}>
      <header>
        <h2>{label}</h2>
        <label htmlFor={id}>Choose replay JSON</label>
        <input
          id={id}
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            void loadFile(event.currentTarget.files?.[0]);
          }}
        />
        {error ? <p role="alert">{error}</p> : null}
      </header>
      {bundle ? (
        <ReplayProvider bundle={bundle}>
          <h3>{bundle.meta.title}</h3>
          <ReplayStage className="stage" aria-label="Recorded page" />
          <Controls />
          <div className="details">
            <ReplaySteps />
            <ReplayInspector>
              {(model) => (
                <section aria-label="Custom diagnostics">
                  <h3>
                    {model.console.length} console messages, {model.network.length} requests
                  </h3>
                  <p>{model.performance.moments.length} performance moments</p>
                  {model.errors.map((issue) => (
                    <button key={`${issue.at}:${issue.kind}:${issue.label}`} type="button" onClick={() => model.seek(issue.at)}>
                      {formatClock(issue.at)} {issue.label}
                    </button>
                  ))}
                </section>
              )}
            </ReplayInspector>
          </div>
        </ReplayProvider>
      ) : (
        <p>Load a recording to compose its stage, controls, steps and diagnostics.</p>
      )}
    </section>
  );
}

function Example() {
  return (
    <main>
      <h1>Your UI, independent replay instances</h1>
      <p>
        Each pane owns its clock. Files stay in this browser. <a href="./headless.html">Framework-free example</a>
      </p>
      <div className="panes">
        <Pane label="Recording A" />
        <Pane label="Recording B" />
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing example root');
const root = createRoot(container);
root.render(<Example />);
window.addEventListener('pagehide', () => root.unmount(), { once: true });
