// A translation for `replays migrate --translate examples/migrate/translate.mjs`: the format deltas a downstream
// distribution that predates the upstream shapes has (docs/downstream-migration.md, row 9 and gap G1). Each step leaves
// an already-converted document as it is, so the same function can also back a plugin's prepareUpload.
//
//   meta.source 'toki' (the old name of the automated producer), or absent  ->  'agent'
//   meta.purpose                          kept when the target declares that purpose, else the tag `purpose:<id>`
//   a typed context (account, organization, ...)  ->  context.fields; app.product -> app.name
//   context.sources[].kind + url          ->  { provider, ref, url, label }
//   a suite's review (a PR reference)     ->  subject; suite people are preserved, and legacy provider handles become named handles

const PROVIDERS = {
  'slack-thread': 'slack',
  'crisp-ticket': 'crisp',
  'github-pr': 'github',
  'github-issue': 'github',
};

/** Legacy provider handles move under `handles`; all current fields remain for core validation. */
function translatePeople(people) {
  return people?.map((person) => {
    const { github, slack, ...current } = person;
    return {
      ...current,
      ...(github || slack || current.handles
        ? { handles: { ...(github ? { github } : {}), ...(slack ? { slack } : {}), ...current.handles } }
        : {}),
    };
  });
}

const CONTEXT_KEYS = new Set(['version', 'capturedAt', 'app', 'test', 'sources', 'fields']);

/** An old `{ kind, url, ... }` source as `{ provider, ref, url, label }`; a new one unchanged. */
export function translateSource(source) {
  if (!source || typeof source !== 'object' || !('kind' in source)) return source;
  const provider = PROVIDERS[source.kind];
  if (!provider) throw new Error(`unknown source kind ${JSON.stringify(source.kind)}`);
  const ref =
    provider === 'github'
      ? typeof source.repository === 'string' && Number.isSafeInteger(Number(source.number)) && Number(source.number) > 0
        ? `${source.repository}#${source.number}`
        : undefined
      : source.id;
  return {
    provider,
    ...(ref ? { ref } : {}),
    url: source.url,
    ...(source.label ? { label: source.label } : {}),
  };
}

/** The typed context's own blocks move to `fields`; the blocks core knows stay where they are. */
export function translateContext(context) {
  if (!context || typeof context !== 'object') return context;
  const fields = { ...context.fields };
  for (const [key, value] of Object.entries(context)) if (!CONTEXT_KEYS.has(key)) fields[key] = value;
  const { product, ...app } = context.app ?? {};
  return {
    version: context.version,
    capturedAt: context.capturedAt,
    ...(context.app ? { app: { ...(product !== undefined && app.name === undefined ? { name: product } : {}), ...app } } : {}),
    ...(context.test ? { test: context.test } : {}),
    ...(context.sources ? { sources: context.sources.map(translateSource) } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
}

/** `replay.json`. */
export default function translate(raw, info) {
  const { purpose, ...meta } = raw.meta;
  meta.source = meta.source === 'human' ? 'human' : 'agent';
  if (meta.people) meta.people = translatePeople(meta.people);
  if (purpose !== undefined) {
    if (info.purposes.includes(purpose)) meta.purpose = purpose;
    else meta.tags = [...new Set([...(meta.tags ?? []), `purpose:${purpose}`])];
  }
  return {
    ...raw,
    meta,
    ...(raw.context ? { context: translateContext(raw.context) } : {}),
  };
}

/** `_suites/<id>.json`. */
export function translateSuite(raw) {
  const { review, ...suite } = raw;
  if (suite.people) suite.people = translatePeople(suite.people);
  return {
    ...suite,
    ...(review && !suite.subject ? { subject: translateSource(review) } : {}),
    ...(suite.context ? { context: translateContext(suite.context) } : {}),
    runs: (suite.runs ?? []).map((run) => (run.context ? { ...run, context: translateContext(run.context) } : run)),
  };
}
