/*
 * Source-link providers: turn a short reference (`acme/api#12`) into the https link the viewer shows.
 *
 * Built in: `github`, `gitlab` and `url`. Add more with a URL template, for example in the config file:
 *
 *   "sourceProviders": [
 *     { "id": "jira", "label": "Jira", "template": "https://jira.example.com/browse/{ref}", "pattern": "^[A-Z]+-\\d+$" }
 *   ]
 *
 * Providers are pure functions of their input, so the capture CLI, the server and the tests share them.
 */
import { assertSafeUrl, type ReplaySourceInput, type ReplaySourceRef, type SourceAttrs, sourceAttrs } from './context.ts';
import { isSafeIconUrl } from './icon-url.ts';

export interface SourceProvider {
  id: string;
  /** Shown in help text and errors. */
  label: string;
  /**
   * The provider's mark in the viewer (topbar chip, Context tab, index rows): a `data:image/svg+xml` URL or an https URL,
   * drawn as an image (never inlined as markup). Without one the viewer shows a link glyph.
   */
  icon?: string;
  /** What one of its sources is, in a sentence: `Chat thread`, `Jira issue`. Used in accessible names and the Context tab. */
  noun?: string;
  /**
   * The link and default label for `ref`, or undefined when `ref` is not one of this provider's. `attrs` are small facts
   * kept with the source (and, capped, in the index summary), e.g. `{ channel: 'support' }`.
   */
  resolve(ref: string): { url: string; label: string; attrs?: SourceAttrs } | undefined;
}

/** What the viewer is told about a provider (`<meta name="app-sources">`). */
export interface SourceProviderInfo {
  id: string;
  label: string;
  noun?: string;
  icon?: string;
}

export interface TemplateProviderConfig {
  id: string;
  label?: string;
  /** An https URL containing `{ref}`; the reference is URL-encoded into it. */
  template: string;
  /** Optional RegExp source the reference must match. */
  pattern?: string;
  /** See SourceProvider.icon. */
  icon?: string;
  /** See SourceProvider.noun. */
  noun?: string;
}

const REPO = '[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}';

/** `owner/repo#12` (issue or pull request: GitHub redirects between them), `owner/repo@<sha>`. */
export function githubProvider(host = 'github.com'): SourceProvider {
  return {
    id: 'github',
    label: 'GitHub',
    resolve(ref) {
      const issue = new RegExp(`^(${REPO})#(\\d{1,9})$`).exec(ref);
      if (issue) return { url: `https://${host}/${issue[1]}/issues/${issue[2]}`, label: `${issue[1]}#${issue[2]}` };
      const commit = new RegExp(`^(${REPO})@([0-9a-fA-F]{7,40})$`).exec(ref);
      if (commit) return { url: `https://${host}/${commit[1]}/commit/${commit[2]}`, label: `${commit[1]}@${commit[2]!.slice(0, 7)}` };
      return undefined;
    },
  };
}

/** `group/project#12` (issue), `group/sub/project!12` (merge request); the host is configurable for self-managed GitLab. */
export function gitlabProvider(host = 'gitlab.com'): SourceProvider {
  return {
    id: 'gitlab',
    label: 'GitLab',
    resolve(ref) {
      const match = /^((?:[A-Za-z0-9._-]{1,100}\/){1,20}[A-Za-z0-9._-]{1,100})([#!])(\d{1,9})$/.exec(ref);
      if (!match) return undefined;
      const route = match[2] === '#' ? 'issues' : 'merge_requests';
      return { url: `https://${host}/${match[1]}/-/${route}/${match[3]}`, label: `${match[1]}${match[2]}${match[3]}` };
    },
  };
}

/** A plain https link; the reference is the URL itself. */
export const urlProvider: SourceProvider = {
  id: 'url',
  label: 'Link',
  resolve(ref) {
    try {
      const url = assertSafeUrl(ref, 'url');
      return { url: url.href, label: url.hostname };
    } catch {
      return undefined;
    }
  },
};

export function templateProvider(config: TemplateProviderConfig): SourceProvider {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(config.id)) throw new Error(`source provider id ${JSON.stringify(config.id)} is invalid`);
  if (!config.template.includes('{ref}')) throw new Error(`source provider ${config.id}: template needs {ref}`);
  // Fail at start, not on the first upload.
  assertSafeUrl(config.template.replaceAll('{ref}', 'x'), `source provider ${config.id} template`);
  const pattern = config.pattern ? new RegExp(config.pattern) : /^[^\s]{1,200}$/;
  return {
    id: config.id,
    label: config.label ?? config.id,
    ...(config.icon === undefined ? {} : { icon: config.icon }),
    ...(config.noun === undefined ? {} : { noun: config.noun }),
    resolve(ref) {
      if (!pattern.test(ref)) return undefined;
      return { url: config.template.replaceAll('{ref}', encodeURIComponent(ref)), label: ref };
    },
  };
}

/** Throws on an icon that is not a safe image URL or a noun that is not short plain text. */
export function assertProviderLook(provider: Pick<SourceProvider, 'id' | 'icon' | 'noun'>) {
  if (provider.icon !== undefined && !isSafeIconUrl(provider.icon))
    throw new Error(`source provider ${provider.id}: icon must be a data:image/svg+xml URL or an https URL`);
  if (provider.noun !== undefined && (typeof provider.noun !== 'string' || !/^[^\n\r<>]{1,40}$/.test(provider.noun)))
    throw new Error(`source provider ${provider.id}: noun must be short text`);
}

export interface SourceProviderOptions {
  githubHost?: string;
  gitlabHost?: string;
  templates?: readonly TemplateProviderConfig[];
}

export class SourceProviders {
  private readonly providers = new Map<string, SourceProvider>();

  constructor(options: SourceProviderOptions = {}) {
    for (const provider of [githubProvider(options.githubHost), gitlabProvider(options.gitlabHost), urlProvider])
      this.providers.set(provider.id, provider);
    for (const template of options.templates ?? []) this.register(templateProvider(template));
  }

  register(provider: SourceProvider) {
    assertProviderLook(provider);
    this.providers.set(provider.id, provider);
    return this;
  }

  get ids() {
    return [...this.providers.keys()];
  }

  /** The providers that bring their own look (an icon or a noun), for the viewer. */
  describe(): SourceProviderInfo[] {
    return [...this.providers.values()]
      .filter((provider) => provider.icon !== undefined || provider.noun !== undefined)
      .map(({ id, label, icon, noun }) => ({ id, label, ...(noun ? { noun } : {}), ...(icon ? { icon } : {}) }));
  }

  /**
   * A complete source (`url` always set). An explicit `url` is kept (it must be https); otherwise the provider
   * resolves `ref`. Throws a message naming `name` on anything that cannot be resolved.
   */
  resolve(input: ReplaySourceInput, name = 'source'): ReplaySourceRef {
    const provider = this.providers.get(input.provider);
    if (!provider) throw new Error(`${name}.provider must be one of ${this.ids.join(', ')}`);
    let url = input.url;
    let label = input.label;
    // An already resolved source (an explicit url) keeps the attrs it carries; capped either way.
    let attrs = sourceAttrs(input.attrs);
    if (url === undefined) {
      if (!input.ref) throw new Error(`${name} needs a ref or a url`);
      const resolved = provider.resolve(input.ref);
      if (!resolved) throw new Error(`${name}.ref is not a valid ${provider.label} reference`);
      url = resolved.url;
      label ??= resolved.label;
      attrs = sourceAttrs(resolved.attrs) ?? attrs;
    }
    assertSafeUrl(url, `${name}.url`);
    return {
      provider: provider.id,
      url,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(label ? { label } : {}),
      ...(attrs ? { attrs } : {}),
    };
  }

  /** `github:owner/repo#12` → a source input (the provider is everything before the first colon). */
  parse(spec: string, name = '--source'): ReplaySourceInput {
    const colon = spec.indexOf(':');
    const provider = colon > 0 ? spec.slice(0, colon) : '';
    const ref = colon > 0 ? spec.slice(colon + 1) : '';
    if (!provider || !ref) throw new Error(`${name} must look like <provider>:<reference>, e.g. github:owner/repo#12`);
    return { provider, ref };
  }
}
