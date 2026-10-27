import contextSchema from '../../docs/formats/context.schema.json' with { type: 'json' };
import replaySchema from '../../docs/formats/replay.schema.json' with { type: 'json' };

import { assertReplayBundle, assertReplayId, type ReplayBundle } from '../shared/replay.ts';
import { compileJsonSchema } from './context-schema.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('docs/formats/replay.schema.json is malformed');
  return value;
}

function schemaStrings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error('docs/formats/replay.schema.json is malformed');
  }
  return value;
}

const properties = schemaRecord(replaySchema.properties);
const meta = schemaRecord(properties.meta);
const metaProperties = schemaRecord(meta.properties);
const requiredMeta = schemaStrings(meta.required);

// why: validate the stable envelope before translators; optional semantic fields and source references may be normalized by plugins.
const envelope = compileJsonSchema({
  type: 'object',
  required: replaySchema.required,
  $defs: replaySchema.$defs,
  properties: {
    meta: { type: 'object', required: requiredMeta, properties: Object.fromEntries(requiredMeta.map((key) => [key, metaProperties[key]])) },
    events: properties.events,
    console: properties.console,
    network: properties.network,
    steps: properties.steps,
    context: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['provider'],
            properties: {
              provider: { type: 'string' },
              ref: { type: 'string' },
              url: { type: 'string' },
              label: { type: 'string' },
            },
          },
        },
      },
    },
  },
});
const bundle = compileJsonSchema(replaySchema, [contextSchema]);

function validate(check: ReturnType<typeof compileJsonSchema>, value: unknown) {
  if (check(value)) return;
  const error = check.errors?.[0];
  const field = error?.instancePath.replaceAll('/', '.') ?? '';
  const message = error?.message?.replace('must be string', 'must be a string') ?? 'is invalid';
  throw Object.assign(new Error(`replay${field} ${message}`), { status: 400 });
}

export function assertUploadEnvelope(value: unknown): void {
  const header = isRecord(value) ? value.meta : undefined;
  if (isRecord(header) && typeof header.id === 'string') assertReplayId(header.id);
  validate(envelope, value);
}

export function assertUploadBundle(value: unknown): asserts value is ReplayBundle {
  assertReplayBundle(value);
  validate(bundle, value);
}
