import type { ResolvedCapture } from './capture-options.ts';
import { PUBLIC_SELECTOR } from './privacy.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import type {
  PrivacyFacts,
  RecorderOptions,
  RecorderPrivacyMode,
  RecorderPrivacyOptions,
  RecordingChoice,
  RecordingChoiceOffer,
} from './types.ts';

/**
 * What a recording may show beyond the parts core always protects (passwords, hidden inputs, credentials). `interface`:
 * the text of elements marked `data-replay-public`.
 */
type Exposure = { text: boolean; inputs: boolean; media: boolean; interface: boolean };
/** The host cap: what any recording may show, and whether its `capture` reads request and response bodies. */
type Cap = Exposure & { bodies: boolean };
type Host = Pick<RecorderOptions, 'choices' | 'privacy' | 'capture'>;

/**
 * One recording's capture and masking, and the profile its bundle names. `by: 'customer'` makes the bundle record the
 * customer's pick in `meta.captured.choice`, with its `mode`.
 */
export type RecordingSettings = {
  capture: ResolvedCapture;
  privacy: RecorderPrivacy;
  profile?: string;
  by?: 'customer';
  mode?: RecorderPrivacyMode;
};
/**
 * Builds a recording's settings from privacy options, with the host's `capture`; `bodies: false` reads no body even
 * when `capture` asks for them.
 * why: passed in, so this lazy chunk shares the core's capture and privacy code without splitting it.
 */
export type SettingsBuilder = (privacy: RecorderPrivacyOptions, bodies?: boolean) => RecordingSettings;

const MODE_EXPOSURE: Readonly<Record<RecorderPrivacyMode, Exposure>> = {
  visible: { text: true, inputs: true, media: true, interface: false },
  'text-masked': { text: false, inputs: false, media: true, interface: false },
  'interface-visible': { text: false, inputs: false, media: false, interface: true },
  masked: { text: false, inputs: false, media: false, interface: false },
};
const STRICTEST_FIRST: readonly RecorderPrivacyMode[] = ['masked', 'interface-visible', 'text-masked', 'visible'];
/** The customer default first, then the stricter Fully masked, then looser modes that need a pick. */
const CUSTOMER_ORDER: readonly RecorderPrivacyMode[] = ['interface-visible', 'masked', 'text-masked', 'visible'];
const CUSTOMER_DEFAULT: RecorderPrivacyMode = 'interface-visible';
const PROFILE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const STORAGE_PREFIX = 'replays-recorder-choice:';

/** The most the host's own `privacy` and `capture` let any recording show. */
function hostCap(host: Host, build: SettingsBuilder): Cap {
  const { capture } = build(host.privacy ?? {});
  return {
    text: !capture.maskAllText,
    inputs: host.privacy?.sanitize === false,
    media: !capture.blockMedia,
    // why: the marker is the host's own markup, so offering the mode is the host's opt-in.
    interface: true,
    bodies: capture.network === 'bodies',
  };
}

const capped = (mode: RecorderPrivacyMode, cap: Exposure): Exposure => {
  const wanted = MODE_EXPOSURE[mode];
  return {
    text: wanted.text && cap.text,
    inputs: wanted.inputs && cap.inputs,
    media: wanted.media && cap.media,
    interface: wanted.interface && cap.interface,
  };
};

/**
 * The host's privacy with `mode` applied. invariant: each field is the stricter of the mode and the host, and a
 * customer recording unmasks no text but the public marker, only in `interface-visible`.
 */
function modePrivacy(host: Host, mode: RecorderPrivacyMode, cap: Exposure): RecorderPrivacyOptions {
  const shown = capped(mode, cap);
  const privacy: RecorderPrivacyOptions = { ...host.privacy, sanitize: !shown.inputs, maskAllText: !shown.text, blockMedia: !shown.media };
  if (shown.interface) privacy.unmaskTextSelector = PUBLIC_SELECTOR;
  else if (host.choices?.by === 'customer') delete privacy.unmaskTextSelector;
  return privacy;
}

function offeredModes(host: Host, cap: Exposure): RecorderPrivacyMode[] {
  const customer = host.choices?.by === 'customer';
  // invariant: a customer can always keep the default and Fully masked.
  const listed: readonly RecorderPrivacyMode[] = [
    ...(host.choices?.privacy ?? []),
    ...(customer ? [CUSTOMER_DEFAULT, 'masked' as const] : []),
  ];
  const seen = new Set<string>();
  // why: strictest first, so modes the cap makes identical keep the name that describes the result.
  const modes = STRICTEST_FIRST.filter((mode) => {
    const shown = capped(mode, cap);
    const key = `${shown.text}${shown.inputs}${shown.media}${shown.interface}`;
    if (!listed.includes(mode) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return customer ? CUSTOMER_ORDER.filter((mode) => modes.includes(mode)) : modes.toReversed();
}

const labelOf = (id: string) => `${id.charAt(0).toUpperCase()}${id.slice(1).replaceAll('-', ' ')}`;

function offeredProfiles(host: Host): RecordingChoiceOffer['profiles'] {
  const profiles = new Map<string, RecordingChoiceOffer['profiles'][number]>();
  for (const entry of host.choices?.profiles ?? []) {
    const option = typeof entry === 'string' ? { id: entry } : entry;
    if (!PROFILE_ID.test(option.id))
      throw new Error(`choices.profiles: "${option.id}" is not a profile id (lower-case letters, digits and "-")`);
    if (profiles.has(option.id)) continue;
    const description = option.description?.trim();
    profiles.set(option.id, { id: option.id, label: option.label ?? labelOf(option.id), ...(description ? { description } : {}) });
  }
  return [...profiles.values()];
}

const firstOffered = <T extends string>(offered: readonly T[], candidates: readonly unknown[]): T | undefined => {
  for (const candidate of candidates) {
    const found = offered.find((item) => item === candidate);
    if (found) return found;
  }
  return;
};

/** why: storage can be blocked or full; a missing memory only means the defaults are shown. */
function remembered(): Partial<Record<keyof RecordingChoice, unknown>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + location.origin) ?? '{}');
    return typeof value === 'object' && value !== null
      ? {
          privacy: Reflect.get(value, 'privacy'),
          profile: Reflect.get(value, 'profile'),
          networkBodies: Reflect.get(value, 'networkBodies'),
        }
      : {};
  } catch {
    return {};
  }
}

function remember(choice: RecordingChoice): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + location.origin, JSON.stringify(choice));
  } catch {
    // why: a blocked store keeps the choice for this recording only.
  }
}

/**
 * The host's `choices`, capped by its `privacy` and `capture`. invariant: a host whose own privacy hides text, inputs
 * and media and reads no body offers nothing, and every choice, whatever its source, is reduced to what is offered. For
 * `by: 'customer'` a recording is `interface-visible` (or `masked`) without bodies unless the choice came from that
 * recording's options step (`accept`), and nothing is remembered.
 */
export function recorderChoices(host: Host, build: SettingsBuilder) {
  const customer = host.choices?.by === 'customer';
  const unmask = host.privacy?.unmaskTextSelector;
  if (customer && unmask !== undefined && unmask !== PUBLIC_SELECTOR)
    throw new Error(`choices.by "customer" allows only privacy.unmaskTextSelector "${PUBLIC_SELECTOR}"; mark product text with it`);
  const cap = hostCap(host, build);
  const bodiesOffered = host.choices?.networkBodies === true;
  const bodiesAllowed = bodiesOffered && cap.bodies;
  const interfaceListed = customer || (host.choices?.privacy ?? []).includes('interface-visible');
  const open = Boolean(host.choices) && (cap.text || cap.inputs || cap.media || bodiesAllowed || interfaceListed);
  const modes = open ? offeredModes(host, cap) : [];
  const profiles = open ? offeredProfiles(host) : [];
  const profileIds = profiles.map((profile) => profile.id);
  const active = modes.length > 1 || profiles.length > 1 || bodiesAllowed;
  const defaults = host.choices?.defaults;
  // invariant: only `accept` adds to it, so a customer's looser choice must come from the options step.
  const picked = new WeakSet<RecordingChoice>();

  const settle = (choice: Partial<Record<keyof RecordingChoice, unknown>> = {}, explicit = false): RecordingChoice => {
    if (!active && !customer) return {};
    const loosen = !customer || explicit;
    const fallback = customer ? CUSTOMER_DEFAULT : modes.at(-1);
    // why: without a pick a customer recording may still be stricter than the default, never looser.
    const unpicked = choice.privacy === 'masked' ? 'masked' : undefined;
    const privacy = firstOffered(
      modes,
      loosen ? [choice.privacy, customer ? undefined : defaults?.privacy, fallback] : [unpicked, fallback],
    );
    const profile = firstOffered(profileIds, [choice.profile, defaults?.profile, profileIds[0]]);
    const bodies = bodiesAllowed && loosen && (choice.networkBodies ?? (customer ? false : defaults?.networkBodies)) === true;
    return { ...(privacy ? { privacy } : {}), ...(profile ? { profile } : {}), ...(bodiesOffered ? { networkBodies: bodies } : {}) };
  };

  /** Settings for a choice that is already settled. */
  const settled = (choice: RecordingChoice): RecordingSettings => {
    // invariant: a customer recording never falls back to the host's own privacy, which is only the cap.
    const mode = choice.privacy ?? (customer ? 'masked' : undefined);
    const privacy = mode ? modePrivacy(host, mode, cap) : (host.privacy ?? {});
    // why: an offered body option, and every customer recording, reads bodies only when they were chosen.
    const built = build(privacy, !(bodiesOffered || customer) || choice.networkBodies === true);
    return {
      ...built,
      ...(choice.profile ? { profile: choice.profile } : {}),
      ...(customer && mode ? { by: 'customer' as const, mode } : {}),
    };
  };

  return {
    settings: (choice?: RecordingChoice): RecordingSettings => settled(settle(choice, choice !== undefined && picked.has(choice))),
    offer(facts: (privacy: RecorderPrivacy) => PrivacyFacts): RecordingChoiceOffer | undefined {
      if (!active) return;
      return {
        by: customer ? 'customer' : 'staff',
        privacy: modes.map((mode) => ({ mode, facts: facts(settled({ privacy: mode }).privacy) })),
        profiles,
        ...(bodiesOffered ? { networkBodies: { allowed: bodiesAllowed } } : {}),
        initial: customer ? settle() : settle(remembered()),
        defaults: settle(),
      };
    },
    accept(choice: RecordingChoice): RecordingChoice {
      const result = settle(choice, true);
      if (!customer && host.choices?.remember !== false) remember(result);
      picked.add(result);
      return result;
    },
  };
}
