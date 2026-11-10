import { type KeyboardEvent, useRef } from 'react';

import { MAX_LABEL } from '../../shared/edit-list.ts';
import { useSelectOnMount } from '../hooks/use-select-on-mount.ts';
import { type StepRenaming, useRenameSession } from './step-rename-context.ts';

/**
 * The inline editor for a step's name: Enter or blur saves, Escape cancels, and "Reset" (shown once the step has its own
 * name) goes back to the automatic label. `onFinish` lets a caller do its own follow-up (the caption resumes playback).
 */
export function StepNameInput({
  renaming,
  renamed,
  onFinish,
  className,
}: {
  renaming: StepRenaming;
  renamed: boolean;
  onFinish: (action: 'save' | 'cancel' | 'reset') => void;
  className?: string;
}) {
  const session = useRenameSession(renaming);
  const input = useRef<HTMLInputElement>(null);
  useSelectOnMount(input);
  const onKeyDown = (event: KeyboardEvent) => {
    // why: keys typed in the name must not reach the viewer's shortcuts (space plays, [ and ] step, f fullscreen).
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      onFinish('save');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onFinish('cancel');
    }
  };
  if (!session) return null;
  return (
    <span className={`step-name-editor ${className ?? ''}`}>
      <input
        ref={input}
        type="text"
        value={session.draft}
        maxLength={MAX_LABEL}
        aria-label="Step name"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => renaming.change(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onFinish('save')}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      {renamed ? (
        <button
          type="button"
          className="step-name-reset"
          aria-label="Reset to automatic name"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFinish('reset')}
        >
          Reset
        </button>
      ) : null}
    </span>
  );
}
