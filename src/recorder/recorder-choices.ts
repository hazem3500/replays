import type { ResolvedCapture } from './capture-options.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import type {
  PrivacyFacts,
  RecorderOptions,
  RecorderPrivacyMode,
  RecorderPrivacyOptions,
  RecordingChoice,
  RecordingChoiceOffer,
} from './types.ts';

/** What a recording may show beyond the parts core always protects (passwords, hidden inputs, credentials). */
type Exposure = { text: boolean; inputs: boolean; media: boolean };
type Host = Pick<RecorderOptions, 'choices' | 'privacy' | 'capture'>;

/** One recording's capture and masking, and the profile its bundle names. */
export type RecordingSettings = { capture: ResolvedCapture; privacy: RecorderPrivacy; profile?: string };
/**
 * Builds a recording's settings from privacy options, with the host's `capture`.
 * why: passed in, so this lazy chunk shares the core's capture and privacy code without splitting it.
 */
export type SettingsBuilder = (privacy: RecorderPrivacyOptions) => RecordingSettings;

const MODE_EXPOSURE: Readonly<Record<RecorderPrivacyMode, Exposure>> = {
  visible: { text: true, inputs: true, media: true },
  'text-masked': { text: false, inputs: false, media: true },
  masked: { text: false, inputs: false, media: false },
};
const STRICTEST_FIRST: readonly RecorderPrivacyMode[] = ['masked', 'text-masked', 'visible'];
const PROFILE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const STORAGE_PREFIX = 'replays-recorder-choice:';

/** The most the host's own `privacy` and `capture` let any recording show. */
function hostCap(host: Host, build: SettingsBuilder): Exposure {
  const { capture } = build(host.privacy ?? {});
  return { text: !capture.maskAllText, inputs: host.privacy?.sanitize === false, media: !capture.blockMedia };
}

const capped = (mode: RecorderPrivacyMode, cap: Exposure): Exposure => {
  const wanted = MODE_EXPOSURE[mode];
  return { text: wanted.text && cap.text, inputs: wanted.inputs && cap.inputs, media: wanted.media && cap.media };
};

/** The host's privacy with `mode` applied. invariant: each field is the stricter of the mode and the host. */
function modePrivacy(host: Host, mode: RecorderPrivacyMode, cap: Exposure): RecorderPrivacyOptions {
  const shown = capped(mode, cap);
  return { ...host.privacy, sanitize: !shown.inputs, maskAllText: !shown.text, blockMedia: !shown.media };
}

function offeredModes(host: Host, cap: Exposure): RecorderPrivacyMode[] {
  const listed = host.choices?.privacy ?? [];
  const seen = new Set<string>();
  // why: strictest first, so modes the cap makes identical keep the name that describes the result.
  const modes = STRICTEST_FIRST.filter((mode) => {
    const shown = capped(mode, cap);
    const key = `${shown.text}${shown.inputs}${shown.media}`;
    if (!listed.includes(mode) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return modes.toReversed();
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
      ? { privacy: Reflect.get(value, 'privacy'), profile: Reflect.get(value, 'profile') }
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
 * The host's `choices`, capped by its `privacy`. invariant: a host whose own privacy hides text, inputs and media
 * offers nothing, and every choice, whatever its source, is reduced to what is offered.
 */
export function recorderChoices(host: Host, build: SettingsBuilder) {
  const cap = hostCap(host, build);
  const open = Boolean(host.choices) && (cap.text || cap.inputs || cap.media);
  const modes = open ? offeredModes(host, cap) : [];
  const profiles = open ? offeredProfiles(host) : [];
  const profileIds = profiles.map((profile) => profile.id);
  const active = modes.length > 1 || profiles.length > 1;
  const defaults = host.choices?.defaults;

  const settle = (choice: Partial<Record<keyof RecordingChoice, unknown>> = {}): RecordingChoice => {
    if (!active) return {};
    const privacy = firstOffered(modes, [choice.privacy, defaults?.privacy, modes.at(-1)]);
    const profile = firstOffered(profileIds, [choice.profile, defaults?.profile, profileIds[0]]);
    return { ...(privacy ? { privacy } : {}), ...(profile ? { profile } : {}) };
  };

  const settings = (choice?: RecordingChoice): RecordingSettings => {
    const settled = settle(choice);
    const built = build(settled.privacy ? modePrivacy(host, settled.privacy, cap) : (host.privacy ?? {}));
    return { ...built, ...(settled.profile ? { profile: settled.profile } : {}) };
  };

  return {
    settings,
    offer(facts: (privacy: RecorderPrivacy) => PrivacyFacts): RecordingChoiceOffer | undefined {
      if (!active) return;
      return {
        privacy: modes.map((mode) => ({ mode, facts: facts(settings({ privacy: mode }).privacy) })),
        profiles,
        initial: settle(remembered()),
        defaults: settle(),
      };
    },
    accept(choice: RecordingChoice): RecordingChoice {
      const settled = settle(choice);
      if (host.choices?.remember !== false) remember(settled);
      return settled;
    },
  };
}
