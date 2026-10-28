/**
 * Beta flags: one registry for the server and the page.
 *
 * Two layers decide whether a beta feature is on:
 *
 *   1. The server is the ceiling. `REPLAYS_BETA_<NAME>=true` or `{ "beta": { "<configKey>": true } }` in the config file
 *      *allows* a flag (src/server/beta.ts parses them; the variable wins). A flag the server does not allow does not
 *      exist for the page: no UI, no routes, no code loaded.
 *   2. The person opts in or out under Settings › Labs (stored per browser today, src/client/settings/labs.ts; a per-user
 *      store can replace it once sign-in carries preferences). With no choice saved, `defaultOn` applies.
 *
 *   effective = allowed ∧ (userToggle ? (choice ?? defaultOn) : true)
 *
 * Every flag here is something an admin deliberately switched on for the deployment, so each defaults on and offers an
 * opt-out: a fresh browser sees exactly what the admin enabled. `userToggle: false` would make a flag a pure server
 * capability (on whenever allowed, never listed in Labs).
 */

export interface BetaFlagDefinition {
  id: string;
  /** Settings › Labs row label. */
  label: string;
  /** One user-facing line under the label. */
  description: string;
  /** The environment variable that allows it on the server. */
  env: `REPLAYS_BETA_${string}`;
  /** Its key under `beta` in the config file. */
  configKey: string;
  /** Its token in `<meta name="app-beta" content="…">` (src/server/index-page.ts). */
  token: string;
  /** Whether a person can opt out (or in) under Settings › Labs. */
  userToggle: boolean;
  /** The effective value when the server allows it and the person has not chosen. */
  defaultOn: boolean;
  /** `reload`: the feature boots with the page (main.tsx), so a change shows after a reload. */
  applies: 'live' | 'reload';
}

export const BETA_FLAGS = [
  {
    id: 'editor',
    label: 'Replay editor',
    // invariant: opting out hides editing only (Edit button, /edit); saved edits still play and export because they are content.
    description: 'Trim, cut, zoom, blur and caption replays. Saved edits play either way.',
    env: 'REPLAYS_BETA_EDITOR',
    configKey: 'editor',
    token: 'editor',
    userToggle: true,
    defaultOn: true,
    applies: 'live',
  },
  {
    id: 'malleable',
    label: 'Plugin workshop',
    // invariant: opting out loads none of src/client/malleable: no workshop, agent bridge or WebMCP tools in this browser.
    description: 'Build sandboxed viewer plugins and let agents connect to open replays.',
    env: 'REPLAYS_BETA_MALLEABLE',
    configKey: 'malleable',
    token: 'malleable',
    userToggle: true,
    defaultOn: true,
    applies: 'reload',
  },
] as const satisfies readonly BetaFlagDefinition[];

/** One registry entry, with its literal id. */
export type BetaFlag = (typeof BETA_FLAGS)[number];
export type BetaFlagId = BetaFlag['id'];
export type BetaFlags = Record<BetaFlagId, boolean>;
/** A person's saved choices; a missing id means "no choice" (the flag's default applies). */
export type BetaChoices = Partial<Record<BetaFlagId, boolean>>;

export const BETA_FLAG_IDS: readonly BetaFlagId[] = BETA_FLAGS.map((flag) => flag.id);

export const NO_BETA: Readonly<BetaFlags> = Object.freeze({ editor: false, malleable: false });

function flagsWhere(on: (flag: BetaFlag) => boolean): BetaFlags {
  const flags: BetaFlags = { ...NO_BETA };
  for (const flag of BETA_FLAGS) flags[flag.id] = on(flag);
  return flags;
}

export function betaFlag(id: BetaFlagId): BetaFlagDefinition {
  const flag = BETA_FLAGS.find((candidate) => candidate.id === id);
  if (!flag) throw new Error(`unknown beta flag ${id}`);
  return flag;
}

/** The allowed set as `<meta name="app-beta">` content: space-separated tokens in registry order. */
export function betaTokens(allowed: Partial<BetaFlags> | undefined): string {
  return BETA_FLAGS.filter((flag) => allowed?.[flag.id])
    .map((flag) => flag.token)
    .join(' ');
}

/** The allowed set back from `<meta name="app-beta">` content (space or comma separated; unknown tokens ignored). */
export function betaFromTokens(content: string | null | undefined): BetaFlags {
  const tokens = new Set((content ?? '').split(/[\s,]+/).filter(Boolean));
  return flagsWhere((flag) => tokens.has(flag.token));
}

/** One flag's effective value: the server's ceiling, then the person's choice, then the default. */
export function betaEffective(id: BetaFlagId, allowed: boolean, choice?: boolean): boolean {
  if (!allowed) return false;
  const flag = betaFlag(id);
  if (!flag.userToggle) return true;
  return choice ?? flag.defaultOn;
}

export function resolveBetaFlags(allowed: Partial<BetaFlags>, choices: BetaChoices = {}): BetaFlags {
  return flagsWhere((flag) => betaEffective(flag.id, Boolean(allowed[flag.id]), choices[flag.id]));
}

/** The flags a person can switch under Settings › Labs on this deployment (allowed and user-toggleable). */
export function labsFlags(allowed: Partial<BetaFlags>): BetaFlag[] {
  return BETA_FLAGS.filter((flag) => flag.userToggle && allowed[flag.id]);
}
