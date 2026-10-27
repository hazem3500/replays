import { useRecorderActions, useRecorderState, useRecordingTimer, useStopAttestation } from '@hazem3500/replays/recorder/react';
import { Button } from './components/ui/button.tsx';
export function RecordingPill({ now }: { now?: (() => number) | undefined }) {
  const state = useRecorderState();
  const actions = useRecorderActions();
  const timer = useRecordingTimer(now ? { now } : {});
  const stopRef = useStopAttestation();
  if (state.status !== 'recording') return null;
  return (
    <div
      className="fixed right-4 bottom-4 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm shadow-lg data-[warning=soon]:border-amber-600 data-[warning=final]:border-red-600 data-[warning=final]:text-red-700"
      data-warning={timer?.warning}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-red-500" />
      <span>Recording</span>
      <span className="font-mono tabular-nums">{timer?.label ?? '0:00'}</span>
      {timer?.warning !== 'none' && timer && <span role="status">{timer.remainingLabel} left</span>}
      <Button ref={stopRef} data-recorder-action="stop" onClick={actions.stop}>
        Stop
      </Button>
    </div>
  );
}
