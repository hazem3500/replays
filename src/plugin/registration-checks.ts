import { compileHandlePattern, HANDLE_ID, isPersonRole } from '../shared/people.ts';
import { assertProviderLook, type SourceProvider } from '../shared/source-providers.ts';
import type { ClientEntry, ContextAdapter, IndexFilterDefinition, PeopleOptions, RenderHooks, SummaryFieldsDefinition } from './types.ts';

/** Refuses a registration, naming the plugin: an invalid shape, or a conflict with what is already registered. */
export type Fail = (message: string, code?: 'invalid-registration' | 'conflict') => never;

/** Plugin-scoped ids (auth adapters, storage, context adapters, client entries, summary fields, index filters). */
export const PLUGIN_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** Plugin index filter params: namespaced, so they can never take a core query parameter, today's or a future one. */
export const INDEX_FILTER_PARAM = /^x-[a-z0-9][a-z0-9-]{0,38}$/;
const BASE = /^\/[A-Za-z0-9._~/-]*$/;
const RENDER_HOOKS = ['posterAt', 'beforeRender', 'afterRender'] as const;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function needFunction(value: unknown, what: string, fail: Fail): void {
  if (typeof value !== 'function') fail(`${what} must be a function`);
}

/** why: reads the member without binding it, since a registration's methods are only checked here, never called. */
function needFunctionAt(owner: object, key: string, what: string, fail: Fail): void {
  needFunction(Reflect.get(owner, key), what, fail);
}

/** The base path as stored: `''` for the root, else without a trailing slash. */
export function checkedBasePath(path: unknown, fail: Fail): string {
  if (typeof path !== 'string' || (path !== '/' && (!BASE.test(path) || path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(path))))
    fail(`basePath must be "/" or an absolute path like "/replays" (got ${JSON.stringify(path)})`);
  return path === '/' ? '' : path.replace(/\/+$/, '');
}

export function checkContextAdapter(adapter: ContextAdapter, fail: Fail): void {
  if (!adapter || typeof adapter.name !== 'string' || !PLUGIN_ID.test(adapter.name)) fail('contextAdapter needs a name like "build-info"');
  if (Reflect.get(adapter, 'normalize') !== undefined) needFunctionAt(adapter, 'normalize', 'contextAdapter.normalize', fail);
  if (adapter.schema && (adapter.schema.type !== 'object' || typeof adapter.schema !== 'object'))
    fail(`contextAdapter ${adapter.name}: schema must be a JSON Schema with "type": "object"`);
}

export function checkSourceProvider(provider: SourceProvider, fail: Fail): void {
  if (!provider || typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(provider.id))
    fail('sourceProvider needs an id like "jira"');
  needFunctionAt(provider, 'resolve', 'sourceProvider.resolve', fail);
  try {
    assertProviderLook(provider);
  } catch (error) {
    fail(errorMessage(error));
  }
  if (['github', 'gitlab', 'url'].includes(provider.id)) fail(`source provider ${JSON.stringify(provider.id)} is built in`, 'conflict');
}

export function checkClientEntry(entry: ClientEntry, fail: Fail): void {
  if (!entry || typeof entry.id !== 'string' || !PLUGIN_ID.test(entry.id)) fail('client entry needs an id like "main"');
  for (const key of ['script', 'style'] as const) {
    const value = entry[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !(value.startsWith('https://') || /^(\/|[A-Za-z]:[\\/])/.test(value)))
      fail(`client ${entry.id}: ${key} must be an absolute file path or an https URL (got ${JSON.stringify(value)})`);
  }
  if (typeof entry.script !== 'string') fail(`client ${entry.id}: script is required`);
}

export function checkRender(definition: RenderHooks, fail: Fail): void {
  if (!definition || typeof definition !== 'object') fail('render needs { posterAt?, beforeRender?, afterRender? }');
  const unknown = Object.keys(definition).find((name) => !RENDER_HOOKS.some((hook) => hook === name));
  if (unknown) fail(`render: unknown hook ${JSON.stringify(unknown)} (use ${RENDER_HOOKS.join(', ')})`);
  if (!RENDER_HOOKS.some((name) => definition[name] !== undefined))
    fail('render needs at least one of posterAt, beforeRender, afterRender');
  for (const name of RENDER_HOOKS) if (definition[name] !== undefined) needFunction(definition[name], `render.${name}`, fail);
}

export function checkSummaryFields(definition: SummaryFieldsDefinition, fail: Fail): void {
  if (!definition || typeof definition.name !== 'string' || !PLUGIN_ID.test(definition.name))
    fail('summaryFields needs a name like "build"');
  needFunctionAt(definition, 'fields', `summaryFields ${definition.name}: fields`, fail);
  if (definition.version !== undefined && !(Number.isInteger(definition.version) && definition.version > 0))
    fail(`summaryFields ${definition.name}: version must be a positive integer`);
}

export function checkIndexFilter(definition: IndexFilterDefinition, fail: Fail): void {
  if (!definition || typeof definition.id !== 'string' || !PLUGIN_ID.test(definition.id)) fail('indexFilter needs an id like "env"');
  needFunctionAt(definition, 'match', `indexFilter ${definition.id}: match`, fail);
  if (typeof definition.param !== 'string' || !INDEX_FILTER_PARAM.test(definition.param))
    fail(`indexFilter ${definition.id}: param must look like "x-env" (got ${JSON.stringify(definition.param)})`);
}

function checkRoles(roles: unknown, fail: Fail): void {
  if (!Array.isArray(roles) || roles.length === 0) fail('people.roles must be a non-empty array');
  const list: unknown[] = roles;
  for (const role of list) if (!isPersonRole(role)) fail(`people.roles: ${JSON.stringify(role)} is not a role like "reviewer"`);
  if (new Set(list).size !== list.length) fail('people.roles lists a role twice');
}

function checkHandle(handle: unknown, ids: Set<string>, fail: Fail): void {
  if (typeof handle !== 'object' || handle === null || !('id' in handle) || typeof handle.id !== 'string' || !HANDLE_ID.test(handle.id))
    fail('people.handles needs ids like "github"');
  const { id } = handle;
  if (ids.has(id)) fail(`people.handles lists ${JSON.stringify(id)} twice`);
  ids.add(id);
  const label = 'label' in handle ? handle.label : undefined;
  if (typeof label !== 'string' || !label.trim() || label.length > 60) fail(`people.handles.${id}: label must be 1-60 characters`);
  const pattern = 'pattern' in handle ? handle.pattern : undefined;
  if (typeof pattern !== 'string' || !pattern) fail(`people.handles.${id}: pattern must be a regular expression source`);
  try {
    compileHandlePattern(pattern);
  } catch (error) {
    fail(`people.handles.${id}: pattern does not compile (${errorMessage(error)})`);
  }
}

/** A deployment's `api.people` options (already known to be an object): hook functions, roles and handles. */
export function checkPeople(config: PeopleOptions, fail: Fail): void {
  for (const key of ['validate', 'avatarUrl', 'profileUrl'] as const)
    if (config[key] !== undefined) needFunction(config[key], `people.${key}`, fail);
  if (config.roles !== undefined) checkRoles(config.roles, fail);
  if (config.handles === undefined) return;
  if (!Array.isArray(config.handles)) fail('people.handles must be an array');
  const ids = new Set<string>();
  for (const handle of config.handles) checkHandle(handle, ids, fail);
}
