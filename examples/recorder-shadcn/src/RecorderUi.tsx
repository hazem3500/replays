import { RecorderRegion, useRecorderState } from '@hazem3500/replays/recorder/react';
import { RecorderButton } from './RecorderButton.tsx';
import { ConsentDialog } from './ConsentDialog.tsx';
import { RecordingPill } from './RecordingPill.tsx';
import { ReviewDialog } from './ReviewDialog.tsx';
import { ResultToast } from './ResultToast.tsx';
export function RecorderUi({ now }: { now?: (() => number) | undefined }) {
  const state = useRecorderState();
  return (
    <>
      <RecorderButton />
      {state.status !== 'idle' && (
        <RecorderRegion>
          <ConsentDialog />
          <RecordingPill now={now} />
          <ReviewDialog />
          <ResultToast />
        </RecorderRegion>
      )}
    </>
  );
}
