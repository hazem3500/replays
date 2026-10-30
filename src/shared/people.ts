/*
 * People on recordings and suites: who asked for it, wrote the change, reviews it. Producers send them explicitly
 * (`meta.people`, a suite's `people`, `--person`); the server never looks anyone up. The deployment may name the roles
 * and the handles it knows (`api.people`, src/plugin/types.ts); without that, roles are free text and only the shape
 * and size here are checked.
 */

/** How a person relates to a recording or suite. */
export interface ReplayPerson {
  /** `[a-z][a-z0-9-]{0,39}`: free text (`reviewer`), or one of the deployment's roles. */
  role: string;
  email?: string;
  /** Display name, 1-80 characters. */
  name?: string;
  /** Accounts elsewhere by handle id (`{ github: 'octocat' }`); the deployment's handles say which ids it links. */
  handles?: Record<string, string>;
}

/** A person as list summaries carry it: the stored fields plus the links the deployment resolves per request. */
export interface ReplayPersonSummary extends ReplayPerson {
  /** An https image URL (`api.people({ avatarUrl })`). */
  avatarUrl?: string;
  /** An https link to the person's profile (`api.people({ profileUrl })`). */
  profileUrl?: string;
}

/** Who "me" is for matching: the signed-in email and the handles the person linked in this browser. */
export interface PersonIdentity {
  email?: string | undefined;
  handles?: Readonly<Record<string, string>> | undefined;
}

export const MAX_PEOPLE = 10;
export const MAX_PERSON_HANDLES = 5;
/** The whole list, serialised: keeps a summary row small whatever the producer sends. */
export const MAX_PEOPLE_BYTES = 4096;

const ROLE = /^[a-z][a-z0-9-]{0,39}$/;
export const HANDLE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const EMAIL = /^[^\s@<>"',;:\\]{1,64}@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
// why: no spaces or control characters; a handle is an account name, not prose.
const HANDLE_VALUE = /^[^\s\p{Cc}]{1,100}$/u;
const NAME_TEXT = /^[^\p{Cc}]+$/u;
const PERSON_KEYS = ['role', 'email', 'name', 'handles'];

/** A deployment handle's `pattern` as the server and the viewer apply it: the whole value, ignoring case. */
export function compileHandlePattern(pattern: string) {
  return new RegExp(`^(?:${pattern})$`, 'i');
}

export function isPersonRole(value: unknown): value is string {
  return typeof value === 'string' && ROLE.test(value);
}

export function isPersonEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value);
}

/** A handle value of any kind (the deployment's pattern, when it has one, is checked by the server). */
export function isHandleValue(value: unknown): value is string {
  return typeof value === 'string' && HANDLE_VALUE.test(value);
}

/** `reviewer ada@example.com` / `reviewer github=octocat`: names a person in error messages. */
export function describePerson(person: Partial<ReplayPerson>) {
  const handles = Object.entries(person.handles ?? {}).map(([id, value]) => `${id}=${value}`);
  return [person.role, person.email, ...handles].filter(Boolean).join(' ');
}

function assertPerson(raw: unknown, label: string): asserts raw is ReplayPerson {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  const person = raw as Record<string, unknown>;
  if (Object.keys(person).some((key) => !PERSON_KEYS.includes(key))) throw new Error(`${label} contains unsupported fields`);
  if (!isPersonRole(person.role)) throw new Error(`${label}.role must be 1-40 characters of a-z, 0-9 or "-", starting with a letter`);
  if (person.email !== undefined && !isPersonEmail(person.email)) throw new Error(`${label}.email is not an email address`);
  if (
    person.name !== undefined &&
    (typeof person.name !== 'string' || !person.name.trim() || person.name.length > 80 || !NAME_TEXT.test(person.name))
  )
    throw new Error(`${label}.name must be 1-80 characters`);
  if (person.handles !== undefined) {
    const handles = person.handles;
    if (!handles || typeof handles !== 'object' || Array.isArray(handles)) throw new Error(`${label}.handles must be an object`);
    const entries = Object.entries(handles);
    if (entries.length === 0 || entries.length > MAX_PERSON_HANDLES)
      throw new Error(`${label}.handles must name 1-${MAX_PERSON_HANDLES} accounts`);
    for (const [id, value] of entries) {
      if (!HANDLE_ID.test(id)) throw new Error(`${label}.handles: ${JSON.stringify(id)} is not a handle id like "github"`);
      if (!isHandleValue(value)) throw new Error(`${label}.handles.${id} must be 1-100 characters without spaces`);
    }
  }
  if (person.email === undefined && person.handles === undefined) throw new Error(`${label} needs an email or a handle`);
}

/** Shape and size: at most MAX_PEOPLE entries, each `{ role, email?, name?, handles? }` with an email or a handle. */
export function assertReplayPeople(value: unknown, name = 'replay.meta.people'): asserts value is ReplayPerson[] {
  if (!Array.isArray(value) || value.length > MAX_PEOPLE) throw new Error(`${name} must be an array of at most ${MAX_PEOPLE} entries`);
  value.forEach((person, index) => assertPerson(person, `${name}[${index}]`));
  if (JSON.stringify(value).length > MAX_PEOPLE_BYTES) throw new Error(`${name} is larger than ${MAX_PEOPLE_BYTES} bytes`);
}

/** The stored fields only, in a stable key order (summaries never carry what a producer may add later). */
export function minimalPeople(people: readonly ReplayPerson[]): ReplayPerson[] {
  return people.map(({ role, email, name, handles }) => ({
    role,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(handles && Object.keys(handles).length ? { handles: { ...handles } } : {}),
  }));
}

const fold = (value: string | undefined) => value?.trim().toLowerCase() || undefined;

/** True when `person` is `me`: the same email, or the same account for a handle `me` linked. Both ignore case. */
export function isPersonMe(person: ReplayPerson, me: PersonIdentity) {
  const email = fold(me.email);
  if (email && fold(person.email) === email) return true;
  return Object.entries(me.handles ?? {}).some(([id, value]) => {
    const mine = fold(value);
    return Boolean(mine && fold(person.handles?.[id]) === mine);
  });
}

/**
 * The role through which `me` relates to `people`, or undefined. With `roles` (the deployment's priority order) the
 * best-ranked matching role wins and unlisted roles rank last; ties, and every match without `roles`, go to the
 * first matching entry.
 */
export function personMatch(
  people: readonly ReplayPerson[] | undefined,
  me: PersonIdentity,
  roles?: readonly string[],
): string | undefined {
  let best: { role: string; rank: number } | undefined;
  for (const person of people ?? []) {
    if (!isPersonMe(person, me)) continue;
    const index = roles ? roles.indexOf(person.role) : 0;
    const rank = index < 0 ? Number.MAX_SAFE_INTEGER : index;
    if (!best || rank < best.rank) best = { role: person.role, rank };
  }
  return best?.role;
}

/**
 * A `--person` flag or `?person=` value: `role:email[:handleId=value]…`. The email may be empty when a handle is
 * given (`reviewer::github=octocat`). Throws naming `name` on anything invalid.
 */
export function parsePerson(value: string, name = '--person'): ReplayPerson {
  const [role = '', email = '', ...rest] = value.trim().split(':');
  const label = `${name} ${JSON.stringify(value)}`;
  if (!value.includes(':')) throw new Error(`${label} must look like role:email[:handle=value]`);
  const handles: Record<string, string> = {};
  for (const part of rest) {
    const at = part.indexOf('=');
    if (at < 1) throw new Error(`${label}: ${JSON.stringify(part)} must look like handle=value`);
    handles[part.slice(0, at)] = part.slice(at + 1);
  }
  const person: ReplayPerson = { role, ...(email ? { email } : {}), ...(rest.length ? { handles } : {}) };
  assertPerson(person, label);
  return person;
}

/** Repeatable `--person` flags (or `?person=` values): parsed, then bounded like `meta.people`. */
export function parsePeopleFlags(values: readonly string[], name = '--person'): ReplayPerson[] {
  if (values.length > MAX_PEOPLE) throw new Error(`${name} can be given at most ${MAX_PEOPLE} times`);
  const people = values.map((value) => parsePerson(value, name));
  assertReplayPeople(people, name);
  return people;
}
