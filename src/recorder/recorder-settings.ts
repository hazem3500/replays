import { resolveCapture } from './capture-options.ts';
import type { RecordingSettings, SettingsBuilder, recorderChoices } from './recorder-choices.ts';
import { recorderPrivacy } from './recorder-privacy.ts';
import type { RecorderOptions, RecordingChoice } from './types.ts';

/** A recording's capture and masking from `privacy`, with the host's `capture`. */
export function settingsBuilder(options: Pick<RecorderOptions, 'choices' | 'privacy' | 'capture'>): SettingsBuilder {
  return (privacy, bodies = true) => {
    const resolved = resolveCapture({ ...options, privacy });
    const capture = bodies || resolved.network !== 'bodies' ? resolved : { ...resolved, network: 'headers' as const };
    return { capture, privacy: recorderPrivacy(privacy, capture) };
  };
}

/**
 * Each recording's settings. The choices module is a separate chunk, loaded only for a host that passes `choices`,
 * so customer pages never download it.
 */
export function recordingSettings(options: Pick<RecorderOptions, 'choices' | 'privacy' | 'capture'>) {
  const build = settingsBuilder(options);
  const base = build(options.privacy ?? {});
  let loaded: ReturnType<typeof recorderChoices> | undefined;
  const choices = options.choices
    ? import('./recorder-choices.ts').then((module) => {
        loaded = module.recorderChoices(options, build);
        return loaded;
      })
    : undefined;
  // why: an invalid `choices` surfaces when a recording starts, not as an unhandled rejection.
  choices?.catch(() => {});
  return {
    base,
    choices: async () => {
      await choices?.catch(() => {});
      return loaded;
    },
    resolve: async (choice?: RecordingChoice): Promise<RecordingSettings> => (choices ? (await choices).settings(choice) : base),
  };
}
