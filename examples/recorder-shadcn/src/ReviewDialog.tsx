import { useId, useRef } from 'react';
import { useRecorderActions, useRecorderPrompt } from '@hazem3500/replays/recorder/react';
import { formatDuration } from '@hazem3500/replays/recorder';
import { Button } from './components/ui/button.tsx';
import { Dialog } from './components/ui/dialog.tsx';
import { Textarea } from './components/ui/textarea.tsx';
export function ReviewDialog() {
  const prompt = useRecorderPrompt();
  const actions = useRecorderActions();
  const note = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  if (prompt?.kind !== 'review') return null;
  return (
    <Dialog title="Send recording?" onCancel={actions.discard}>
      <p>
        {formatDuration(prompt.summary.durationMs)} · {prompt.summary.consoleErrors} errors · {prompt.summary.failedRequests} failed
        requests
      </p>
      <label htmlFor={id} className="block">
        Add a note (optional)
        <Textarea id={id} ref={note} maxLength={2000} data-recorder-field="note" />
      </label>
      <div className="flex justify-end gap-2">
        <Button data-initial-focus data-recorder-action="discard" onClick={actions.discard}>
          Discard
        </Button>
        <Button data-recorder-action="send" onClick={() => actions.send(note.current?.value)}>
          Send recording
        </Button>
      </div>
    </Dialog>
  );
}
