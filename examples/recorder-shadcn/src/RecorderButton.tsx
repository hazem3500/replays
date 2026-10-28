import { useRecorderActions, useRecorderState } from '@hazem3500/replays/recorder/react';
import { selectCanRequest, recorderUiProps } from '@hazem3500/replays/recorder';
import { Button } from './components/ui/button.tsx';
export function RecorderButton() {
  const actions = useRecorderActions();
  const canRequest = useRecorderState(selectCanRequest);
  return (
    <Button
      {...recorderUiProps}
      disabled={!canRequest}
      onClick={() => {
        void actions.request();
      }}
    >
      Record this tab
    </Button>
  );
}
