import { XIcon } from 'lucide-react';
import { useEntryMotion } from '../hooks/use-entry-motion.ts';

/** Phones: the expanded search's way out. Clearing and leaving the field is one tap, since there is no Esc key. */
export function CommandCancel({ onClose }: { onClose: () => void }) {
  const ref = useEntryMotion<HTMLButtonElement>('number');
  return (
    <button
      ref={ref}
      type="button"
      className="command-cancel"
      aria-label="Close search"
      // why: keeps focus in the field while pressed, so it does not collapse before the click lands.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClose}
    >
      <XIcon aria-hidden="true" />
    </button>
  );
}
