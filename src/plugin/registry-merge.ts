import { mergeRedactionRules } from '../shared/redaction.ts';
import { PluginError } from './errors.ts';
import { assertDistinctPolicies } from './request-policy.ts';
import type { Owned, PluginRegistry } from './registry-types.ts';
import type { IndexFilterDefinition } from './types.ts';

function union<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>, what: string) {
  for (const key of a.keys()) if (b.has(key)) throw new PluginError('conflict', `${what} ${JSON.stringify(key)} is registered twice`);
  return new Map([...a, ...b]);
}

function mergeIndexFilters(a: readonly Owned<IndexFilterDefinition>[], b: readonly Owned<IndexFilterDefinition>[]) {
  const clash = b.find((entry) => a.some((other) => other.value.param === entry.value.param));
  if (clash) throw new PluginError('conflict', `index filter param ${JSON.stringify(clash.value.param)} is registered twice`);
  return [...a, ...b];
}

/**
 * One registry from two: `first`'s plugins are set up and their hooks run before `second`'s. The built-in plugins are
 * merged under the user's, so the user's branding and base path win. Names that appear in both are a conflict.
 */
export function mergeRegistries(first: PluginRegistry, second: PluginRegistry): PluginRegistry {
  const clash = first.order.find((name) => second.order.includes(name));
  if (clash) throw new PluginError('duplicate-plugin', 'is listed twice', { plugin: clash });
  const profile = second.profiles.find((entry) => first.profiles.some((other) => other.value.id === entry.value.id));
  if (profile)
    throw new PluginError('conflict', `profile ${JSON.stringify(profile.value.id)} is registered twice`, { plugin: profile.plugin });
  const view = second.views.find((entry) => first.views.some((other) => other.value.id === entry.value.id));
  if (view) throw new PluginError('conflict', `view ${JSON.stringify(view.value.id)} is registered twice`, { plugin: view.plugin });
  if (first.people && second.people)
    throw new PluginError('conflict', `registers people, but ${first.people.plugin} already did; a deployment has one`, {
      plugin: second.people.plugin,
    });
  assertDistinctPolicies(first.requestPolicies, second.requestPolicies);
  return {
    requestPolicies: [...first.requestPolicies, ...second.requestPolicies],
    uploadEndpoints: union(first.uploadEndpoints, second.uploadEndpoints, 'upload endpoint'),
    order: [...first.order, ...second.order],
    auth: union(first.auth, second.auth, 'auth adapter'),
    contextAdapters: [...first.contextAdapters, ...second.contextAdapters],
    sourceProviders: [...first.sourceProviders, ...second.sourceProviders],
    storage: union(first.storage, second.storage, 'storage backend'),
    branding: { ...first.branding, ...second.branding },
    basePath: second.basePath ?? first.basePath,
    redaction: mergeRedactionRules(first.redaction, second.redaction),
    hooks: {
      preAuth: [...first.hooks.preAuth, ...second.hooks.preAuth],
      postAuth: [...first.hooks.postAuth, ...second.hooks.postAuth],
      response: [...first.hooks.response, ...second.hooks.response],
      prepareUpload: [...first.hooks.prepareUpload, ...second.hooks.prepareUpload],
      normalizeUpload: [...first.hooks.normalizeUpload, ...second.hooks.normalizeUpload],
      beforeUpload: [...first.hooks.beforeUpload, ...second.hooks.beforeUpload],
      afterUpload: [...first.hooks.afterUpload, ...second.hooks.afterUpload],
      webPreAuth: [...first.hooks.webPreAuth, ...second.hooks.webPreAuth],
      webPostAuth: [...first.hooks.webPostAuth, ...second.hooks.webPostAuth],
    },
    routes: [...first.routes, ...second.routes],
    clientEntries: [...first.clientEntries, ...second.clientEntries],
    profiles: [...first.profiles, ...second.profiles],
    views: [...first.views, ...second.views],
    retention: [...first.retention, ...second.retention],
    render: [...first.render, ...second.render],
    summaryFields: [...first.summaryFields, ...second.summaryFields],
    indexFilters: mergeIndexFilters(first.indexFilters, second.indexFilters),
    people: first.people ?? second.people,
    identityResolvers: [...first.identityResolvers, ...second.identityResolvers],
  };
}
