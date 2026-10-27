import { useRecorderActions, useRecorderState } from '@hazem3500/replays/recorder/react';
import { selectError, selectUploadProgress } from '@hazem3500/replays/recorder';
import { Button } from './components/ui/button.tsx';
import { Progress } from './components/ui/progress.tsx';
import { Toast } from './components/ui/sonner.tsx';
export function ResultToast() {
  const state = useRecorderState();
  const actions = useRecorderActions();
  const error = selectError(state);
  const progress = selectUploadProgress(state);
  if (!['uploading', 'uploaded', 'error'].includes(state.status)) return null;
  let message = error?.message;
  if (state.status === 'uploading') message = 'Sending…';
  if (state.status === 'uploaded') message = 'Recording sent';
  return (
    <Toast>
      <p role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      {state.status === 'uploading' ? (
        <Progress value={progress?.fraction} />
      ) : (
        <div className="flex gap-2">
          {error?.phase === 'upload' && (
            <Button
              data-recorder-action="retry"
              onClick={() => {
                void actions.retry().catch(() => {});
              }}
            >
              Retry
            </Button>
          )}
          {error?.link && (
            <a href={error.link.url} target="_blank" rel="noopener noreferrer">
              {error.link.label}
            </a>
          )}
          <Button data-recorder-action="dismiss" onClick={actions.dismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </Toast>
  );
}
