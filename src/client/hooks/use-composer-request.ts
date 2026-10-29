import { type RefObject, useEffect } from 'react';

/**
 * Answers a "start a comment" request (`M`): marks it handled and puts the cursor in `field`. At once when the panel is
 * already up; on the next frame when the panel has only just mounted and the field is not attached yet.
 */
export function useComposerRequest(request: { id: number } | undefined, consume: () => void, field: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    if (!request) return;
    consume();
    if (field.current) field.current.focus();
    else requestAnimationFrame(() => field.current?.focus());
  }, [request, consume, field]);
}
