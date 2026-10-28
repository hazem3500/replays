import { useRecorderActions, useRecorderPrompt } from '@hazem3500/replays/recorder/react';
import { Button } from './components/ui/button.tsx';
import { Dialog } from './components/ui/dialog.tsx';
export function ConsentDialog() {
  const prompt = useRecorderPrompt();
  const actions = useRecorderActions();
  if (prompt?.kind !== 'consent') return null;
  const privacy = prompt.privacy;
  return (
    <Dialog title="Record this tab?" onCancel={actions.decline}>
      <p>Up to {Math.ceil(prompt.maxDurationMs / 60000)} minutes. Stop whenever you like.</p>
      <p>
        {privacy?.mode === 'visible' ? 'Visible page content may be recorded. Passwords stay masked.' : 'Page text and inputs are masked.'}{' '}
        {privacy?.reviewRequired === false ? 'Sent when you stop.' : 'Review before sending.'}
      </p>
      <div className="flex justify-end gap-2">
        <Button data-initial-focus data-recorder-action="consent-decline" onClick={actions.decline}>
          Not now
        </Button>
        <Button data-recorder-action="consent-accept" onClick={actions.accept}>
          Record
        </Button>
      </div>
    </Dialog>
  );
}
