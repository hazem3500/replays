import contextSchema from '../../docs/formats/context.schema.json' with { type: 'json' };
import replaySchema from '../../docs/formats/replay.schema.json' with { type: 'json' };

import { assertReplayBundle, assertReplayId, type ReplayBundle } from '../shared/replay.ts';
import { compileJsonSchema } from './context-schema.ts';

type Schema = Record<string, unknown>;
const properties = replaySchema.properties as Record<string, Schema>;
const meta = properties.meta!;
const metaProperties = meta.properties as Record<string, Schema>;
const requiredMeta = meta.required as string[];

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
  const header = (value as { meta?: unknown } | null)?.meta;
  if (header && typeof header === 'object' && 'id' in header) assertReplayId(String(header.id ?? ''));
  validate(envelope, value);
}

export function assertUploadBundle(value: unknown): asserts value is ReplayBundle {
  assertReplayBundle(value);
  validate(bundle, value);
}
