import { personMatch } from '../shared/people.ts';
import type { ReplayPerson } from '../shared/people.ts';
import type { Identity } from './auth/types.ts';

/** The role that may rename steps on any replay. */
export const ADMIN_ROLE = 'admin';

const namesOf = (value: unknown) =>
  JSON.stringify(
    Object.entries(typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );

/** True when a save's `stepNames` differ from the stored ones. */
export function changesStepNames(input: unknown, stored: { stepNames?: unknown }) {
  const next = typeof input === 'object' && input !== null && 'stepNames' in input ? input.stepNames : undefined;
  return namesOf(next) !== namesOf(stored.stepNames);
}

/**
 * Whether `identity` may rename steps on a replay with these `people`: signed in with an email that matches a person in any
 * role, or holding the admin role. invariant: only the verified identity counts; handles a browser says it linked are
 * claims, not proof, so they never authorise a write.
 */
export function mayRenameSteps(identity: Pick<Identity, 'email' | 'roles'>, people: readonly ReplayPerson[] | undefined) {
  if (identity.roles?.includes(ADMIN_ROLE)) return true;
  return Boolean(identity.email && personMatch(people, { email: identity.email }) !== undefined);
}
