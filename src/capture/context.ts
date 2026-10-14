import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertReplayContext, MAX_CONTEXT_BYTES, type ReplayContext, type ReplaySourceInput } from '../shared/context.ts';
import { SourceProviders } from '../shared/source-providers.ts';
import type { ContextSchema } from '../server/context-schema.ts';

export interface ContextOptions {
  /** Resolves `sources` references (github, gitlab, url and any configured templates). */
  sources?: SourceProviders;
  /** The deployment's JSON Schema for `fields`; the same check the server runs on upload. */
  schema?: ContextSchema;
}

/**
 * Builds the context block from a test runner's JSON file: `{ app?, test?, sources?, fields?, capturedAt? }`.
 * It only reads what the runner hands over — it never looks at the browser, its storage or any account.
 * `sources` entries are `{ provider, ref }` (resolved to a link) or `{ provider, url, label? }`.
 */
export function buildReplayContext(value: unknown, capturedAtFallback: string, options: ContextOptions = {}): ReplayContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('the context file must be a JSON object');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !['capturedAt', 'app', 'test', 'sources', 'fields'].includes(key));
  if (unknown.length) throw new Error(`the context file has unsupported keys: ${unknown.join(', ')}`);
  const providers = options.sources ?? new SourceProviders();
  const context: Record<string, unknown> = {
    version: 1,
    capturedAt: input.capturedAt ?? capturedAtFallback,
    ...(input.app !== undefined ? { app: input.app } : {}),
    ...(input.test !== undefined ? { test: input.test } : {}),
    ...(input.sources !== undefined
      ? {
          sources: (Array.isArray(input.sources) ? input.sources : []).map((source, index) =>
            providers.resolve(source as ReplaySourceInput, `context.sources[${index}]`),
          ),
        }
      : {}),
    ...(input.fields !== undefined ? { fields: input.fields } : {}),
  };
  assertReplayContext(context);
  if (context.fields !== undefined && options.schema) {
    const problem = options.schema.validate(context.fields);
    if (problem) throw new Error(problem);
  }
  return context;
}

export async function readContextFile(path: string | undefined): Promise<unknown> {
  if (!path) return undefined;
  const absolute = resolve(path);
  if ((await stat(absolute)).size > MAX_CONTEXT_BYTES) throw new Error(`--context-file must be at most ${MAX_CONTEXT_BYTES / 1024} KB`);
  return JSON.parse(await readFile(absolute, 'utf8')) as unknown;
}
