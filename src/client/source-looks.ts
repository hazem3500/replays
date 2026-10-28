import { isSafeIconUrl } from '../shared/icon-url.ts';
import { isProviderMark, type ProviderMark, type SourceProviderInfo } from '../shared/source-providers.ts';

/*
 * How the deployment's source providers look: the icon, mark and noun each declared (`<meta name="app-sources">`, written
 * by the server from SourceProviders.describe). Providers without any are absent; the viewer falls back to its own
 * marks (by provider id, else a link glyph). Icons are re-checked here: only a safe image URL is ever drawn, and only as an <img>.
 */

export interface SourceLook {
  label: string;
  noun?: string;
  icon?: string;
  mark?: ProviderMark;
}

let cached: Map<string, SourceLook> | undefined;

function read(): Map<string, SourceLook> {
  const looks = new Map<string, SourceLook>();
  if (typeof document === 'undefined') return looks;
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-sources"]')?.content;
  if (!content) return looks;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) return looks;
    for (const entry of parsed as Partial<SourceProviderInfo>[]) {
      if (typeof entry?.id !== 'string') continue;
      looks.set(entry.id, {
        label: typeof entry.label === 'string' ? entry.label : entry.id,
        ...(typeof entry.noun === 'string' && entry.noun ? { noun: entry.noun } : {}),
        ...(isSafeIconUrl(entry.icon) ? { icon: entry.icon } : {}),
        ...(isProviderMark(entry.mark) ? { mark: entry.mark } : {}),
      });
    }
  } catch {
    // Malformed content: no looks.
  }
  return looks;
}

/** The provider's declared look, when it has one. Constant for the page's life. */
export function sourceLook(provider: string): SourceLook | undefined {
  cached ??= read();
  return cached.get(provider);
}

/** Tests only: forget what was read (or use `looks` instead of the page's meta). */
export function setSourceLooksForTests(looks: Record<string, SourceLook> | undefined) {
  cached = looks ? new Map(Object.entries(looks)) : undefined;
}
