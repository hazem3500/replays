import type { IncomingMessage } from 'node:http';

import type { PluginRegistry } from '../plugin/registry.ts';
import type { PersonHandle } from '../plugin/types.ts';
import {
  compileHandlePattern,
  describePerson,
  HANDLE_ID,
  isHandleValue,
  isPersonEmail,
  type PersonIdentity,
  type ReplayPerson,
  type ReplayPersonSummary,
} from '../shared/people.ts';
import type { ReplaySourceLink, ReplaySummary } from '../shared/replay.ts';
import type { ReviewSuiteIndexEntry, ReviewSuiteSummary } from '../shared/review-suite.ts';
import type { Identity } from './auth/types.ts';

/*
 * The request-time half of people (src/shared/people.ts) and identity resolvers: the deployment's checks on upload, its
 * avatar and profile links on the way out, "For me" queries, and the identity enrichment that runs after auth.
 */

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const log = (plugin: string, what: string, error: unknown) =>
  console.error(`plugin ${plugin}: ${what} failed:`, error instanceof Error ? error.message : error);

/** An absolute https URL without credentials, at most 2048 characters; anything else is undefined. */
export function httpsUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const patterns = new WeakMap<PersonHandle, RegExp>();
function handleTest(handle: PersonHandle) {
  let pattern = patterns.get(handle);
  if (!pattern) patterns.set(handle, (pattern = compileHandlePattern(handle.pattern)));
  return pattern;
}

/**
 * The deployment's checks on people that already passed the shape check: known roles, known handles matching their
 * pattern, then `validate`. A refusal is a 400 that names the person; a `validate` that throws is a 500.
 */
export function checkPeople(registry: PluginRegistry, people: readonly ReplayPerson[] | undefined, name: string) {
  const owned = registry.people;
  if (!owned || !people?.length) return;
  const { roles, handles, validate } = owned.value;
  people.forEach((person, index) => {
    const who = `${name}[${index}] (${describePerson(person)})`;
    if (roles && !roles.includes(person.role)) throw httpError(400, `${who}: role must be one of ${roles.join(', ')}`);
    for (const [id, value] of Object.entries(person.handles ?? {})) {
      if (!handles) continue;
      const handle = handles.find((entry) => entry.id === id);
      if (!handle)
        throw httpError(
          400,
          `${who}: unknown handle ${JSON.stringify(id)} (known: ${handles.map((entry) => entry.id).join(', ') || 'none'})`,
        );
      if (!handleTest(handle).test(value)) throw httpError(400, `${who}: ${JSON.stringify(value)} is not a valid ${handle.label}`);
    }
    if (!validate) return;
    let problem: string | undefined | void;
    try {
      problem = validate(person);
    } catch (error) {
      log(owned.plugin, 'people.validate', error);
      throw httpError(500, 'people validation failed');
    }
    if (typeof problem === 'string' && problem) throw httpError(400, `${who}: ${problem}`);
  });
}

/** `people` with the deployment's avatar and profile links (https only; a failing callback just leaves its link out). */
export function decoratePeople(
  registry: PluginRegistry,
  people: readonly ReplayPerson[],
  sources: readonly ReplaySourceLink[] = [],
): ReplayPersonSummary[] {
  const owned = registry.people;
  if (!owned || (!owned.value.avatarUrl && !owned.value.profileUrl)) return [...people];
  const { avatarUrl, profileUrl } = owned.value;
  const call = (what: string, run: () => unknown) => {
    try {
      return httpsUrl(run());
    } catch (error) {
      log(owned.plugin, `people.${what}`, error);
      return undefined;
    }
  };
  return people.map((person) => {
    const avatar = avatarUrl ? call('avatarUrl', () => avatarUrl(person)) : undefined;
    const profile = profileUrl ? call('profileUrl', () => profileUrl(person, { sources })) : undefined;
    return { ...person, ...(avatar ? { avatarUrl: avatar } : {}), ...(profile ? { profileUrl: profile } : {}) };
  });
}

/** A replay summary with its people's links; summaries without people are returned as they are (never mutated). */
export function decorateSummary<T extends ReplaySummary>(registry: PluginRegistry, summary: T): T {
  if (!summary.people?.length || !registry.people) return summary;
  return { ...summary, people: decoratePeople(registry, summary.people, summary.sources) };
}

/** A suite summary (and its runs' replays, when it has them) with the people's links. */
export function decorateSuite<T extends ReviewSuiteSummary & Partial<Pick<ReviewSuiteIndexEntry, 'runDetails'>>>(
  registry: PluginRegistry,
  suite: T,
): T {
  if (!registry.people) return suite;
  const sources = suite.subject ? [suite.subject] : [];
  return {
    ...suite,
    ...(suite.people?.length ? { people: decoratePeople(registry, suite.people, sources) } : {}),
    ...(suite.runDetails
      ? { runDetails: suite.runDetails.map((run) => (run.replay ? { ...run, replay: decorateSummary(registry, run.replay) } : run)) }
      : {}),
  };
}

export const MAX_LINKED_HANDLES = 8;

/**
 * `?for=me`: the signed-in email plus the handles the person linked, sent as `handle.<id>=value`. Each value must
 * match the deployment's pattern (or, without `api.people` handles, the generic shape); an unknown or invalid one is a
 * 400. Undefined unless `for=me`.
 */
export function forMeQuery(registry: PluginRegistry, params: URLSearchParams, identity: Identity): PersonIdentity | undefined {
  if (params.get('for') !== 'me') return undefined;
  const known = registry.people?.value.handles;
  const handles: Record<string, string> = {};
  for (const [key, raw] of params) {
    if (!key.startsWith('handle.')) continue;
    const id = key.slice('handle.'.length);
    const value = raw.trim();
    if (!value) continue;
    if (Object.keys(handles).length >= MAX_LINKED_HANDLES) throw httpError(400, `at most ${MAX_LINKED_HANDLES} handle.<id> parameters`);
    const handle = known?.find((entry) => entry.id === id);
    if (known && !handle) throw httpError(400, `${key}: unknown handle (known: ${known.map((entry) => entry.id).join(', ') || 'none'})`);
    if (!HANDLE_ID.test(id) || !isHandleValue(value) || (handle && !handleTest(handle).test(value)))
      throw httpError(400, `${key} is not a valid ${handle?.label ?? 'handle'}`);
    handles[id] = value;
  }
  return { ...(identity.email ? { email: identity.email } : {}), handles };
}

/** What `GET /api/me` says about people: the roles in priority order and the handles a person can link. */
export function peopleConfig(registry: PluginRegistry) {
  const options = registry.people?.value;
  if (!options) return undefined;
  return {
    ...(options.roles ? { roles: [...options.roles] } : {}),
    handles: (options.handles ?? []).map(({ id, label, pattern }) => ({ id, label, pattern })),
  };
}

/**
 * Runs the identity resolvers (plugin order, each on the previous result), once per request. Only `name`, an https
 * `avatarUrl` and a missing `email` are taken; a result with another `id` is refused and logged, as is a resolver that
 * throws: the request goes on with what it had.
 */
export function identityResolver(registry: PluginRegistry) {
  const cache = new WeakMap<IncomingMessage, Promise<Identity>>();
  async function run(identity: Identity, request: IncomingMessage) {
    let current = identity;
    for (const { plugin, value } of registry.identityResolvers) {
      let next: Identity | undefined | void;
      try {
        next = await value.resolve({ ...current }, { request });
      } catch (error) {
        log(plugin, 'identity.resolve', error);
        continue;
      }
      if (!next || typeof next !== 'object') continue;
      if (next.id !== current.id) {
        log(plugin, 'identity.resolve', new Error(`may not change the identity's id (${JSON.stringify(current.id)})`));
        continue;
      }
      const name = typeof next.name === 'string' && next.name.trim() ? next.name.trim().slice(0, 200) : undefined;
      const avatarUrl = httpsUrl(next.avatarUrl);
      const email = !current.email && isPersonEmail(next.email) ? next.email : undefined;
      current = { ...current, ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}), ...(email ? { email } : {}) };
    }
    return current;
  }
  return (identity: Identity, request: IncomingMessage): Promise<Identity> => {
    if (!registry.identityResolvers.length) return Promise.resolve(identity);
    let pending = cache.get(request);
    if (!pending) cache.set(request, (pending = run(identity, request)));
    return pending;
  };
}
