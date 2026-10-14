import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  classifyUpload,
  MAX_UPLOAD_BYTES,
  parseTags,
  prepareUpload,
  titleFromFileName,
  uploadErrorMessage,
  uploadRequest,
} from '../src/client/upload/prepare.ts';
import { replay } from './fixtures.ts';

const rrweb = [
  { type: 4, data: { href: 'https://app.example.com/?api_token=x', width: 390, height: 844 }, timestamp: 1000 },
  { type: 2, data: { node: { type: 0, id: 1, childNodes: [] } }, timestamp: 1200 },
  { type: 3, data: { source: 1, positions: [] }, timestamp: 4000 },
];

const file = (name: string, content: string | Uint8Array, type = '') => new File([content as BlobPart], name, { type });

const metaOf = (request: { body: string }) => JSON.parse(request.body).meta as Record<string, unknown>;

describe('browser upload preparation', () => {
  it('detects plain rrweb events and previews them with the shared importer', async () => {
    const prepared = await prepareUpload(file('checkout-bug_support.json', JSON.stringify({ events: rrweb })));
    expect(prepared).toMatchObject({
      kind: 'rrweb',
      eventCount: 3,
      duration: 3000,
      viewport: { width: 390, height: 844 },
      title: 'Checkout bug support',
    });
    expect(prepared.startUrl).toBe('https://app.example.com/?api_token=%5Bredacted%5D');
  });

  it('detects a replay bundle and keeps its title', async () => {
    const bundle = replay('bundle-id');
    const prepared = await prepareUpload(file('replay.json', JSON.stringify(bundle)));
    expect(prepared).toMatchObject({
      kind: 'bundle',
      eventCount: 2,
      duration: 1000,
      title: 'Test replay',
      startUrl: 'https://example.com/',
    });
  });

  it('reads .json.gz files by their gzip magic bytes', async () => {
    const gz = gzipSync(JSON.stringify(rrweb));
    const prepared = await prepareUpload(file('events.json.gz', new Uint8Array(gz)));
    expect(prepared.kind).toBe('rrweb');
    expect(prepared.title).toBe('Uploaded recording');
    expect(prepared.text).toBe(JSON.stringify(rrweb));
  });

  it('reads the committed human sample bundle', async () => {
    const sample = await readFile('sample/human-demo.json', 'utf8');
    expect((await prepareUpload(file('human-demo.json', sample))).kind).toBe('bundle');
  });

  it('explains files it cannot use', async () => {
    await expect(prepareUpload(file('notes.txt', 'hello', 'text/plain'))).rejects.toThrow(/\.json or \.json\.gz/);
    await expect(prepareUpload(file('broken.json', '{"events": ['))).rejects.toThrow(/not valid JSON/);
    await expect(prepareUpload(file('broken.json.gz', new Uint8Array([0x1f, 0x8b, 1, 2, 3])))).rejects.toThrow(/could not be decompressed/);
    await expect(prepareUpload(file('one.json', JSON.stringify([rrweb[0]])))).rejects.toThrow(/at least two events/);
    await expect(prepareUpload(file('nosnap.json', JSON.stringify([rrweb[0], rrweb[2]])))).rejects.toThrow(/no full snapshot/);
    const bad = { ...replay(), meta: { ...replay().meta, version: 2 } };
    expect(() => classifyUpload(bad, 'bad.json', '')).toThrow(/bundle, but it is not valid/);
    const huge = gzipSync(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 32));
    await expect(prepareUpload(file('huge.json.gz', new Uint8Array(huge)))).rejects.toThrow(/larger than the 25 MB/);
  });

  it('builds the request: rrweb goes to the import route, bundles carry edits in meta', () => {
    const plain = classifyUpload(rrweb, 'events.json', JSON.stringify(rrweb));
    expect(uploadRequest(plain, { title: ' Login ', url: '' })).toEqual({ path: 'replays/import?title=Login', body: plain.text });
    expect(uploadRequest(plain, { title: 'A', url: 'https://x.test/' }).path).toBe('replays/import?title=A&url=https%3A%2F%2Fx.test%2F');
    const bundle = classifyUpload(replay('b'), 'replay.json', '');
    const request = uploadRequest(bundle, { title: 'Renamed', url: 'https://new.test/' });
    expect(request.path).toBe('replays');
    expect(request.id).toBe('b');
    expect(JSON.parse(request.body).meta).toMatchObject({ title: 'Renamed', url: 'https://new.test/' });
  });

  it('carries picked tags: repeated query parameters for rrweb, meta.tags for bundles', () => {
    const plain = classifyUpload(rrweb, 'events.json', JSON.stringify(rrweb));
    expect(uploadRequest(plain, { title: 'A', url: '', tags: ['smoke', 'checkout'] }).path).toBe(
      'replays/import?title=A&tag=smoke&tag=checkout',
    );
    expect(uploadRequest(plain, { title: 'A', url: '', tags: [] }).path).toBe('replays/import?title=A');
    const plainBundle = classifyUpload(replay('b'), 'replay.json', '');
    expect(metaOf(uploadRequest(plainBundle, { title: 'B', url: '' }))).not.toHaveProperty('tags');
    expect(metaOf(uploadRequest(plainBundle, { title: 'B', url: '', tags: ['smoke'] })).tags).toEqual(['smoke']);
    const explicit = replay('c');
    explicit.meta.tags = ['nightly'];
    const tagged = classifyUpload(explicit, 'replay.json', '');
    // Untouched keeps the file's own tags in place (same key order), a pick replaces them, an empty list clears them.
    const kept = uploadRequest(tagged, { title: explicit.meta.title, url: '' });
    expect(kept.body).toBe(JSON.stringify(explicit));
    expect(metaOf(uploadRequest(tagged, { title: 'C', url: '', tags: ['smoke'] })).tags).toEqual(['smoke']);
    expect(metaOf(uploadRequest(tagged, { title: 'C', url: '', tags: [] }))).not.toHaveProperty('tags');
  });

  it('reads typed tags as a list, lower-cased and de-duplicated, and reports the ones the server would refuse', () => {
    expect(parseTags('Smoke, checkout  smoke\nv1.2')).toEqual({ tags: ['smoke', 'checkout', 'v1.2'], invalid: [], tooMany: false });
    expect(parseTags('')).toEqual({ tags: [], invalid: [], tooMany: false });
    expect(parseTags('ok, -bad, has/slash').invalid).toEqual(['-bad', 'has/slash']);
    expect(parseTags('a b c d e f g h i j k').tooMany).toBe(true);
  });

  it('names files and errors calmly', () => {
    expect(titleFromFileName('replay.json')).toBe('Uploaded recording');
    expect(titleFromFileName('tracker-timer.json.gz')).toBe('Tracker timer');
    expect(uploadErrorMessage(413, 'upload is larger than 25 MB').message).toMatch(/25 MB upload limit/);
    expect(uploadErrorMessage(409, 'replay b already exists', 'b')).toMatchObject({ existingId: 'b' });
    // A suite-run conflict is not an id clash: no link to a replay that was never stored.
    const conflict = uploadErrorMessage(409, 'review suite run already has a different recording', 'b');
    expect(conflict.existingId).toBeUndefined();
    expect(conflict.message).toMatch(/review suite run already has a different recording/);
    expect(uploadErrorMessage(400, 'the recording has no full snapshot (rrweb event type 2)').message).toBe(
      'The server rejected this file: the recording has no full snapshot (rrweb event type 2).',
    );
    expect(uploadErrorMessage(500, 'internal error').message).toMatch(/could not store/);
  });
});
