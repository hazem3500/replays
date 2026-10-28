import { createTransaction } from '@tanstack/react-db';

/**
 * Query collection options whose synced rows replace the old ones. The adapter sends whole rows (refetches and direct
 * writes alike), but TanStack DB merges synced updates by default (`rowUpdateMode: 'partial'`): a field the server
 * dropped, like a reopened comment's `resolved` or a released replay's `kept`, would otherwise stay.
 */
export function wholeRows<T extends { sync: object }>(options: T): T {
  return { ...options, sync: { ...options.sync, rowUpdateMode: 'full' as const } };
}

/**
 * Shows `change` at once (TanStack DB's optimistic layer), then runs `persist`, which sends it and lands the server's
 * rows. Resolves with what `persist` returned; when it throws, the change rolls back and the promise rejects with it.
 */
export async function optimistic<T>(change: () => void, persist: () => Promise<T>): Promise<T> {
  const sent: { result?: Promise<T> } = {};
  const transaction = createTransaction({
    mutationFn: async () => {
      sent.result = persist();
      await sent.result;
    },
  });
  transaction.mutate(change);
  await transaction.when('settled');
  if (!sent.result) throw new Error('The change settled without being sent.');
  return sent.result;
}
