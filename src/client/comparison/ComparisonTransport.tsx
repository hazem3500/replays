import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { formatClock } from '../../shared/replay.ts';
import { SPEEDS, type ReplayController, type Speed } from '../player.ts';
import type { ComparisonCoordinator } from './coordinator.ts';
import type { ComparisonError } from './model.ts';
import { PlayIcon, PauseIcon } from 'lucide-react';
import { ViewerPlayButton, ViewerTransportFrame } from '../viewer/presentation.tsx';
import { ComparisonScrub } from './scrub.ts';

export function ComparisonTransport({ coordinator, getPlayers }: { coordinator: ComparisonCoordinator; getPlayers(): ReplayController[] }) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const scrub = useMemo(() => new ComparisonScrub(coordinator, getPlayers), [coordinator, getPlayers]);
  const range = useRef<HTMLInputElement>(null);
  const capture = useRef<number | undefined>(undefined);
  const release = () => {
    const pointer = capture.current;
    capture.current = undefined;
    if (pointer !== undefined && range.current?.hasPointerCapture(pointer)) range.current.releasePointerCapture(pointer);
  };
  useEffect(() => {
    const cancel = () => {
      scrub.finish(false);
      const element = range.current;
      const pointer = capture.current;
      capture.current = undefined;
      if (pointer !== undefined && element?.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    };
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [scrub]);

  const canPlay = state.duration > 0;
  return (
    <section className="cmp-transport" aria-label="Shared playback controls">
      <ViewerTransportFrame>
        <div className="cmp-transport-row">
          <div className="cmp-controls">
            <ViewerPlayButton
              label={state.status === 'playing' ? 'Pause both recordings' : 'Play both recordings'}
              disabled={!canPlay}
              onClick={() => {
                scrub.finish(false);
                coordinator.toggle();
              }}
            >
              {state.status === 'playing' ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
            </ViewerPlayButton>
            <button type="button" disabled={!canPlay} aria-label="Back 5 seconds" onClick={() => coordinator.seek(state.time - 5000)}>
              −5s
            </button>
            <button type="button" disabled={!canPlay} aria-label="Forward 5 seconds" onClick={() => coordinator.seek(state.time + 5000)}>
              +5s
            </button>
            <label>
              Speed{' '}
              <select value={state.speed} onChange={(event) => coordinator.setSpeed(Number(event.target.value) as Speed)}>
                {SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <output aria-label="Shared elapsed time" aria-live="off">
            {formatClock(state.time)} / {formatClock(state.duration)}
          </output>
        </div>
        <label className="cmp-timeline-label" htmlFor="comparison-timeline">
          Shared elapsed timeline <span>{state.status}</span>
        </label>
        <input
          ref={range}
          id="comparison-timeline"
          className="cmp-timeline"
          type="range"
          min={0}
          max={Math.max(1, state.duration)}
          step={100}
          disabled={!canPlay}
          value={state.time}
          aria-valuetext={`${formatClock(state.time)} of ${formatClock(state.duration)}`}
          onChange={(event) => coordinator.seek(Number(event.target.value))}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            scrub.begin();
            capture.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={() => {
            scrub.finish();
            release();
          }}
          onPointerCancel={() => {
            scrub.finish(false);
            release();
          }}
          onLostPointerCapture={() => scrub.finish()}
          onBlur={() => {
            scrub.finish();
            release();
          }}
          onKeyDown={(event) => {
            if (event.key === ' ') {
              event.preventDefault();
              scrub.finish(false);
              coordinator.toggle();
              return;
            }
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              scrub.begin();
              const at = coordinator.getSnapshot().time;
              coordinator.seek(
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? state.duration
                    : at +
                      (event.key === 'PageUp'
                        ? 10000
                        : event.key === 'PageDown'
                          ? -10000
                          : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                            ? -1000
                            : 1000),
              );
            }
          }}
          onKeyUp={() => scrub.finish()}
        />
      </ViewerTransportFrame>
    </section>
  );
}

export function ComparisonAlignment({
  coordinator,
  errors,
  onError,
}: {
  coordinator: ComparisonCoordinator;
  errors: ComparisonError[];
  onError(error: ComparisonError): void;
}) {
  const duration = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().duration);
  return (
    <>
      <ErrorNavigation errors={errors} onError={onError} duration={duration} />
      <OffsetControl coordinator={coordinator} />
    </>
  );
}

const ErrorNavigation = memo(function ErrorNavigation({
  errors,
  onError,
  duration,
}: {
  errors: ComparisonError[];
  onError(error: ComparisonError): void;
  duration: number;
}) {
  const markers = errors.filter((error) => error.sharedAt >= 0 && error.sharedAt <= duration);
  return (
    <>
      <div className="cmp-error-ruler" aria-hidden="true">
        {markers.slice(0, 200).map((error) => (
          <i key={error.id} data-side={error.side} style={{ left: `${(100 * error.sharedAt) / Math.max(1, duration)}%` }} />
        ))}
      </div>
      <p className="cmp-help">
        Arrow keys seek 1s, Page Up/Down 10s, Home/End reach boundaries, Space plays or pauses. Error ticks: A above, B below.
      </p>
      {markers.length > 200 ? (
        <p className="cmp-help">{markers.length - 200} error ticks omitted; the paginated Captured errors panel contains all events.</p>
      ) : null}
      {errors.length ? (
        <label className="cmp-marker-picker">
          Jump to captured error
          <select
            value=""
            onChange={(event) => {
              const selected = errors.find((error) => error.id === event.target.value);
              if (selected) onError(selected);
            }}
          >
            <option value="">Choose side and event…</option>
            {errors.slice(0, 200).map((error) => (
              <option key={error.id} value={error.id} disabled={error.sharedAt < 0 || error.sharedAt > duration}>
                {error.side.toUpperCase()} · {formatClock(Math.abs(error.sharedAt))}
                {error.sharedAt < 0 ? ' before shared start' : ' shared'} · {error.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {errors.length > 200 ? (
        <p className="cmp-help">The picker shows the first 200 errors. Show Captured errors in Customize to browse all {errors.length}.</p>
      ) : null}
    </>
  );
});

function OffsetControl({ coordinator }: { coordinator: ComparisonCoordinator }) {
  const offsetB = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().offsetB);
  return <OffsetForm key={offsetB} offsetB={offsetB} coordinator={coordinator} />;
}

function OffsetForm({ offsetB, coordinator }: { offsetB: number; coordinator: ComparisonCoordinator }) {
  const [offset, setOffset] = useState(String(offsetB / 1000));
  const [offsetError, setOffsetError] = useState('');
  return (
    <form
      className="cmp-offset"
      onSubmit={(event) => {
        event.preventDefault();
        const seconds = Number(offset);
        if (!offset.trim() || !Number.isFinite(seconds) || Math.abs(seconds) > 86400) {
          setOffsetError('Enter an offset between −86400 and 86400 seconds.');
          return;
        }
        coordinator.pause();
        coordinator.setOffsetB(seconds * 1000);
        setOffsetError('');
      }}
    >
      <label>
        B offset (seconds)
        <input
          type="number"
          step="0.1"
          min={-86400}
          max={86400}
          value={offset}
          aria-describedby="comparison-offset-help"
          aria-invalid={Boolean(offsetError)}
          onChange={(event) => setOffset(event.target.value)}
        />
      </label>
      <button type="submit">Apply offset</button>
      <button
        type="button"
        onClick={() => {
          coordinator.pause();
          coordinator.setOffsetB(0);
          setOffset('0');
          setOffsetError('');
        }}
      >
        Reset offset
      </button>
      <p id="comparison-offset-help">
        B = shared elapsed {offsetB >= 0 ? '+' : '−'} {Math.abs(offsetB / 1000)}s. Negative offsets hold B at its start. Each recording
        keeps its original duration.
      </p>
      {offsetError ? <p role="alert">{offsetError}</p> : null}
    </form>
  );
}
