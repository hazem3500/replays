import type { RecorderPrivacyMode, RecordingChoice } from './types.ts';

/** sessionStorage key shared with the early entry, which cannot import anything. */
export const RELOAD_FLAG_KEY = 'replays-record-after-reload';
/** How long a reload may take before the flag is stale and ignored. */
export const RELOAD_FLAG_TTL_MS = 30_000;

type Stored = { exp: number; choice: RecordingChoice };

const PRIVACY: Record<string, RecorderPrivacyMode> = {
  visible: 'visible',
  'inputs-masked': 'inputs-masked',
  'text-masked': 'text-masked',
  'interface-visible': 'interface-visible',
  masked: 'masked',
};

/** Keeps only the known choice fields with the right types; the flag lives in page-writable storage, so it is never trusted as is. */
function cleanChoice(value: unknown): RecordingChoice | undefined {
  if (typeof value !== 'object' || value === null) return;
  const raw: Record<string, unknown> = { ...value };
  const choice: RecordingChoice = { fromLoad: true };
  const privacy = typeof raw.privacy === 'string' ? PRIVACY[raw.privacy] : undefined;
  if (privacy) choice.privacy = privacy;
  if (typeof raw.profile === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(raw.profile)) choice.profile = raw.profile;
  for (const key of ['networkBodies', 'performance', 'debugging'] as const) {
    const flag = raw[key];
    if (typeof flag === 'boolean') choice[key] = flag;
  }
  return choice;
}

/** Saves the choice for the next page load. Returns false where storage is blocked, so the caller records on this page instead. */
export function armReload(choice: RecordingChoice, now = Date.now(), storage: Storage = sessionStorage): boolean {
  try {
    const stored: Stored = { exp: now + RELOAD_FLAG_TTL_MS, choice };
    storage.setItem(RELOAD_FLAG_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and removes the flag. invariant: it is removed before anything else happens, so it fires once, and a stale or
 * malformed flag is dropped without starting anything, which is what keeps a failed resume from looping.
 */
export function takeReload(now = Date.now(), storage: Storage = sessionStorage): RecordingChoice | undefined {
  try {
    const text = storage.getItem(RELOAD_FLAG_KEY);
    if (text === null) return;
    storage.removeItem(RELOAD_FLAG_KEY);
    const stored: unknown = JSON.parse(text);
    if (typeof stored !== 'object' || stored === null || !('exp' in stored) || !('choice' in stored)) return;
    if (typeof stored.exp !== 'number' || stored.exp < now || stored.exp > now + RELOAD_FLAG_TTL_MS) return;
    return cleanChoice(stored.choice);
  } catch {
    return;
  }
}
