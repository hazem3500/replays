import { CheckIcon, CopyIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { strings } from './strings.ts';
import { IconSwap } from '@/components/icon-swap.tsx';

const COPIED_FOR_MS = 1500;

/**
 * A shell command as a read-only field: one line that scrolls sideways (never wraps), with a copy button inside on the right.
 * Copying swaps the icon for a check for 1.5 s and announces "Copied"; when the clipboard is unavailable the command is
 * selected instead, so it can be copied by hand.
 */
export function CommandField({ command, label, hint }: { command: string; label: string; hint?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function copy() {
    clearTimeout(reset.current);
    try {
      await navigator.clipboard.writeText(command);
      setState('copied');
      reset.current = setTimeout(() => setState('idle'), COPIED_FOR_MS);
    } catch {
      setState('failed');
      input.current?.select();
    }
  }

  return (
    <div
      className="settings-command"
      ref={(node) => {
        // why: a pending reset must not fire after the field unmounts.
        if (!node) clearTimeout(reset.current);
      }}
    >
      <div className="settings-command-field" data-state={state}>
        <input
          ref={input}
          className="settings-command-text"
          readOnly
          value={command}
          spellCheck={false}
          autoComplete="off"
          aria-label={label}
          aria-describedby={hintId}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="settings-command-copy press-settle"
          aria-label={strings.command.copy(label)}
          onClick={() => {
            void copy();
          }}
        >
          <IconSwap state={state === 'copied' ? 'b' : 'a'}>
            <CopyIcon className="icon-a" />
            <CheckIcon className="icon-b" />
          </IconSwap>
        </button>
      </div>
      <p className="sr-only" role="status">
        {state === 'copied' ? strings.command.copied : ''}
      </p>
      <p id={hintId} className="settings-command-hint" {...(state === 'failed' ? { role: 'alert' } : {})}>
        {state === 'failed' ? strings.command.copyFailed : hint}
      </p>
    </div>
  );
}
