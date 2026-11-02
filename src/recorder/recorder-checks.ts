import type { RecorderOptions } from './types.ts';

/** Logs each distinct warning once per recorder. */
export function createWarner(): (message: string) => void {
  const warnings = new Set<string>();
  return (message) => {
    if (warnings.has(message)) return;
    warnings.add(message);
    console.warn(`[replays recorder] ${message}`);
  };
}

/**
 * Checks that the call follows a user activation. With `strictInvariants` a missing activation throws; otherwise it warns
 * during the migration window.
 */
export function activationCheck(
  options: Pick<RecorderOptions, 'activation' | 'strictInvariants'>,
  warn: (message: string) => void,
): () => void {
  return () => {
    const userActivation = typeof navigator === 'undefined' ? undefined : navigator.userActivation;
    const activation = options.activation ?? (userActivation ? () => userActivation.isActive : undefined);
    if (!activation) {
      warn('User activation API unavailable; check skipped');
      return;
    }
    if (activation()) return;
    if (options.strictInvariants) throw new Error('A user activation is required');
    warn('A user activation is required (warn-only migration)');
  };
}
