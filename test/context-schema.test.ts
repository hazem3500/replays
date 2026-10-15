import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { compileContextSchema, type ContextSchema, loadContextSchema } from '../src/server/context-schema.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const SCHEMA = {
  type: 'object',
  required: ['feature'],
  additionalProperties: false,
  properties: {
    feature: { type: 'string', title: 'Feature', enum: ['coupons', 'checkout'] },
    ticket: { type: 'string', title: 'Ticket', format: 'uri' },
    retries: { type: 'integer', minimum: 0, maximum: 5 },
    owner: { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
};

const CAPTURED_AT = '2026-10-10T12:00:00.000Z';

const withFields = (id: string, fields: unknown) => {
  const bundle = replay(id);
  bundle.context = { version: 1, capturedAt: CAPTURED_AT, fields: fields as Record<string, unknown> };
  return bundle;
};
const post = (api: string, body: unknown) =>
  fetch(`${api}/replays`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const put = (url: string, body: unknown) =>
  fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const suiteWith = (context: unknown) => ({
  version: 1,
  id: 'schema-suite',
  title: 'Schema suite',
  createdAt: CAPTURED_AT,
  context,
});
const runWith = (fields: unknown) => ({
  id: 'run-1',
  sequence: 1,
  label: 'Run',
  status: 'running',
  startedAt: '2026-10-10T12:01:00.000Z',
  context: { version: 1, capturedAt: '2026-10-10T12:01:00.000Z', fields },
});

describe('compileContextSchema', () => {
  it('accepts a JSON Schema object and exposes it unchanged', () => {
    const compiled = compileContextSchema(SCHEMA);
    expect(compiled.schema).toBe(SCHEMA);
  });

  it('refuses a schema that is not an object schema', () => {
    for (const bad of [null, undefined, 'text', 3, [], [SCHEMA]])
      expect(() => compileContextSchema(bad)).toThrow('the context schema must be a JSON Schema object');
    expect(() => compileContextSchema({ type: 'array' })).toThrow('must describe an object ("type": "object")');
    expect(() => compileContextSchema({ properties: {} })).toThrow('must describe an object ("type": "object")');
  });

  it('refuses a schema that is not valid JSON Schema', () => {
    expect(() => compileContextSchema({ type: 'object', properties: { a: { type: 'nope' } } })).toThrow(/type/);
  });

  describe('validate', () => {
    const { validate } = compileContextSchema(SCHEMA);

    it('returns undefined for valid fields', () => {
      expect(validate({ feature: 'coupons' })).toBeUndefined();
      expect(
        validate({
          feature: 'checkout',
          ticket: 'https://tickets.example.com/SHOP-7',
          retries: 2,
          owner: { email: 'ada@example.com' },
          tags: ['a', 'b'],
        }),
      ).toBeUndefined();
    });

    it('names the field with a dotted path and says what is wrong', () => {
      expect(validate({})).toBe("context.fields must have required property 'feature'");
      expect(validate({ feature: 'other' })).toBe('context.fields.feature must be equal to one of the allowed values');
      expect(validate({ feature: 7 })).toBe('context.fields.feature must be string');
      expect(validate({ feature: 'coupons', retries: 9 })).toBe('context.fields.retries must be <= 5');
      expect(validate({ feature: 'coupons', retries: 1.5 })).toBe('context.fields.retries must be integer');
      expect(validate({ feature: 'coupons', extra: true })).toBe('context.fields must NOT have additional properties');
      expect(validate({ feature: 'coupons', owner: { email: 'nope' } })).toBe('context.fields.owner.email must match format "email"');
      expect(validate({ feature: 'coupons', tags: ['a', 'b', 'c', 'd'] })).toBe('context.fields.tags must NOT have more than 3 items');
      expect(validate({ feature: 'coupons', tags: [1] })).toBe('context.fields.tags.0 must be string');
    });

    it('checks formats such as uri', () => {
      expect(validate({ feature: 'coupons', ticket: 'not a uri' })).toBe('context.fields.ticket must match format "uri"');
    });

    it('reports one problem at a time', () => {
      const message = validate({ feature: 'other', retries: 99 });
      expect(message).toMatch(/^context\.fields\.\w+ /);
      expect(message?.split('\n')).toHaveLength(1);
    });
  });
});

describe('loadContextSchema', () => {
  it('reads and compiles a schema file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-schema-'));
    const file = join(dir, 'context.schema.json');
    await writeFile(file, JSON.stringify(SCHEMA));
    const loaded = await loadContextSchema(file);
    expect(loaded.schema).toEqual(SCHEMA);
    expect(loaded.validate({ feature: 'coupons' })).toBeUndefined();
  });

  it('names the file when it cannot be read or parsed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-schema-'));
    await expect(loadContextSchema(join(dir, 'missing.json'))).rejects.toThrow(/^cannot read CONTEXT_SCHEMA_FILE .*missing\.json/);
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{ not json');
    await expect(loadContextSchema(bad)).rejects.toThrow(/^cannot read CONTEXT_SCHEMA_FILE /);
    const notObject = join(dir, 'array.json');
    await writeFile(notObject, '[]');
    await expect(loadContextSchema(notObject)).rejects.toThrow('must be a JSON Schema object');
  });
});

describe('the schema in the server', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function start(contextSchema?: ContextSchema) {
    const root = await mkdtemp(join(tmpdir(), 'replays-schema-app-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    const handle = createApp({ ...appDefaults(), store, clientDir: join(root, 'client'), ...(contextSchema ? { contextSchema } : {}) });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return { api: `http://127.0.0.1:${address.port}/api`, store };
  }

  it('stores an upload whose fields satisfy the schema', async () => {
    const { api } = await start(compileContextSchema(SCHEMA));
    const response = await post(
      api,
      withFields('valid-fields', { feature: 'coupons', ticket: 'https://tickets.example.com/SHOP-7', retries: 1 }),
    );
    expect(response.status).toBe(201);
    await expect((await fetch(`${api}/replays/valid-fields`)).json()).resolves.toMatchObject({
      context: { fields: { feature: 'coupons', retries: 1 } },
    });
  });

  it('refuses an upload whose fields violate the schema with a 400 naming the field, and stores nothing', async () => {
    const { api } = await start(compileContextSchema(SCHEMA));
    const cases: Array<[string, unknown, string]> = [
      ['wrong-enum', { feature: 'unknown' }, 'context.fields.feature must be equal to one of the allowed values'],
      ['wrong-type', { feature: 'coupons', retries: 'many' }, 'context.fields.retries must be integer'],
      ['missing-required', { retries: 1 }, "context.fields must have required property 'feature'"],
      ['bad-format', { feature: 'coupons', ticket: 'not a uri' }, 'context.fields.ticket must match format "uri"'],
      ['extra-key', { feature: 'coupons', extra: 1 }, 'context.fields must NOT have additional properties'],
    ];
    for (const [id, fields, message] of cases) {
      const response = await post(api, withFields(id, fields));
      expect(response.status).toBe(400);
      expect(await response.text()).toBe(message);
      expect((await fetch(`${api}/replays/${id}`)).status).toBe(404);
    }
  });

  it('checks the schema only when the context has fields', async () => {
    const { api } = await start(compileContextSchema(SCHEMA));
    const bundle = replay('no-fields');
    bundle.context = { version: 1, capturedAt: CAPTURED_AT, app: { name: 'Shop Demo' } };
    // No `fields` at all: nothing to validate, the upload is accepted.
    expect((await post(api, bundle)).status).toBe(201);
    expect((await post(api, withFields('empty-fields', {}))).status).toBe(400);
  });

  it('does not constrain fields without a configured schema', async () => {
    const { api } = await start();
    expect((await post(api, withFields('free-form', { anything: [1, 2, 3], nested: { ok: true } }))).status).toBe(201);
  });

  it('applies the schema to a suite registration and to a run registration', async () => {
    const { api } = await start(compileContextSchema(SCHEMA));
    const bad = await put(`${api}/suites/schema-suite`, suiteWith({ version: 1, capturedAt: CAPTURED_AT, fields: { feature: 'nope' } }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe('context.fields.feature must be equal to one of the allowed values');
    expect((await fetch(`${api}/suites/schema-suite`)).status).toBe(404);

    const good = await put(
      `${api}/suites/schema-suite`,
      suiteWith({ version: 1, capturedAt: CAPTURED_AT, fields: { feature: 'checkout' } }),
    );
    expect(good.status).toBe(200);

    const badRun = await put(`${api}/suites/schema-suite/runs/run-1`, runWith({ feature: 'checkout', retries: 50 }));
    expect(badRun.status).toBe(400);
    expect(await badRun.text()).toBe('context.fields.retries must be <= 5');
    expect((await put(`${api}/suites/schema-suite/runs/run-1`, runWith({ feature: 'checkout', retries: 2 }))).status).toBe(200);
  });

  it('publishes the schema in /api/config for the viewer, and nothing when there is none', async () => {
    const withSchema = await start(compileContextSchema(SCHEMA));
    const config = (await (await fetch(`${withSchema.api}/config`)).json()) as { contextSchema?: unknown };
    expect(config.contextSchema).toEqual(SCHEMA);
    const without = await start();
    const plain = (await (await fetch(`${without.api}/config`)).json()) as Record<string, unknown>;
    expect('contextSchema' in plain).toBe(false);
  });
});
