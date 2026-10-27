import { useState, useSyncExternalStore } from 'react';
import { formatClock, type ReplayBundle } from '../../shared/replay.ts';
import type { ComparisonCoordinator, ComparisonSide } from './coordinator.ts';

/** Confirmed origins, never duration-normalized or guessed from similar labels. */
export function ScenarioAlignment({
  bundles,
  coordinator,
}: {
  bundles: Partial<Record<ComparisonSide, ReplayBundle>>;
  coordinator: ComparisonCoordinator;
}) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const [a, setA] = useState(Math.max(0, state.offsetA));
  const [b, setB] = useState(Math.max(0, state.offsetB));
  const [message, setMessage] = useState('');
  const ready = Boolean(bundles.a && bundles.b && state.a.duration && state.b.duration);
  return (
    <form
      className="cmp-scenario-alignment"
      aria-label="Scenario start alignment"
      onSubmit={(event) => {
        event.preventDefault();
        if (!coordinator.setScenarioStarts(a, b)) {
          setMessage('Choose a start before the end of each loaded recording.');
          return;
        }
        setMessage('Scenario starts aligned. Shared time is now zero; original playback speed is unchanged.');
      }}
    >
      <h3>Start together</h3>
      <p className="cmp-help">Choose the same action in each recording. Differences after that action stay visible.</p>
      <div className="cmp-alignment-pair">
        <StartPicker
          label="Before"
          bundle={bundles.a}
          value={a}
          onChange={setA}
          current={state.a.time}
          onCurrent={() => {
            coordinator.pause();
            setA(coordinator.getSnapshot().a.time);
          }}
        />
        <StartPicker
          label="After"
          bundle={bundles.b}
          value={b}
          onChange={setB}
          current={state.b.time}
          onCurrent={() => {
            coordinator.pause();
            setB(coordinator.getSnapshot().b.time);
          }}
        />
      </div>
      <div className="cmp-alignment-actions">
        <button type="submit" disabled={!ready}>
          Align scenario starts
        </button>
        <button
          type="button"
          onClick={() => {
            coordinator.resetAlignment();
            setA(0);
            setB(0);
            setMessage('Returned to recording starts.');
          }}
        >
          Use recording starts
        </button>
      </div>
      <p className="cmp-help">
        Current origin: Before {formatClock(state.offsetA)}; After{' '}
        {state.offsetB < 0 ? `waits ${formatClock(-state.offsetB)}` : formatClock(state.offsetB)}.
      </p>
      <p role="status">{message}</p>
    </form>
  );
}

function StartPicker({
  label,
  bundle,
  value,
  onChange,
  current,
  onCurrent,
}: {
  label: string;
  bundle: ReplayBundle | undefined;
  value: number;
  onChange(value: number): void;
  current: number;
  onCurrent(): void;
}) {
  const selected = bundle?.steps.findIndex((step) => step.at === value) ?? -1;
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        {label} start (seconds)
        <input
          type="number"
          min={0}
          max={(bundle?.meta.duration ?? 0) / 1000}
          step="0.1"
          value={Number.isFinite(value) ? value / 1000 : ''}
          disabled={!bundle}
          onChange={(event) => onChange(Math.round(event.currentTarget.valueAsNumber * 1000))}
        />
      </label>
      <label>
        {label} recorded step
        <select
          value={selected < 0 ? '' : String(selected)}
          disabled={!bundle?.steps.length}
          onChange={(event) => {
            if (!event.target.value) return;
            const step = bundle?.steps[Number(event.target.value)];
            if (step) onChange(step.at);
          }}
        >
          <option value="">Choose an action…</option>
          {bundle?.steps.map((step, index) => (
            <option key={index} value={index}>
              {index + 1}. {step.label} · {formatClock(step.at)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!bundle || current >= bundle.meta.duration} onClick={onCurrent}>
        Use current {label.toLowerCase()} moment
      </button>
    </fieldset>
  );
}
