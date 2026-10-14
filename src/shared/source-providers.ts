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
import { assertSafeUrl, type ReplaySourceInput, type ReplaySourceRef } from './context.ts';

export interface SourceProvider {
  id: string;
  /** Shown in help text and errors. */
  label: string;
  /** The link and default label for `ref`, or undefined when `ref` is not one of this provider's. */
  resolve(ref: string): { url: string; label: string } | undefined;
}

export interface TemplateProviderConfig {
  id: string;
  label?: string;
  /** An https URL containing `{ref}`; the reference is URL-encoded into it. */
  template: string;
  /** Optional RegExp source the reference must match. */
  pattern?: string;
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
    resolve(ref) {
      if (!pattern.test(ref)) return undefined;
      return { url: config.template.replaceAll('{ref}', encodeURIComponent(ref)), label: ref };
    },
  };
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
    this.providers.set(provider.id, provider);
    return this;
  }

  get ids() {
    return [...this.providers.keys()];
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
    if (url === undefined) {
      if (!input.ref) throw new Error(`${name} needs a ref or a url`);
      const resolved = provider.resolve(input.ref);
      if (!resolved) throw new Error(`${name}.ref is not a valid ${provider.label} reference`);
      url = resolved.url;
      label ??= resolved.label;
    }
    assertSafeUrl(url, `${name}.url`);
    return {
      provider: provider.id,
      url,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(label ? { label } : {}),
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
