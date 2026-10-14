import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodeXml, S3Error, S3Storage, signV4, uriEncode } from '../src/server/storage/s3.ts';
import { NotFoundError } from '../src/server/storage/types.ts';
import { type S3Emulator, startS3Emulator } from './s3-emulator.ts';

describe('SigV4 signer', () => {
  const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const now = new Date('2013-05-24T00:00:00Z');

  it('reproduces the AWS "GET Object" example', () => {
    const headers = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      credentials,
      now,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('reproduces the AWS "GET Bucket (List Objects)" example', () => {
    const headers = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      credentials,
      now,
    });
    expect(headers.authorization).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  it('is deterministic, and changes with the secret and the body hash', () => {
    const base = { method: 'PUT', url: new URL('http://h/b/k'), payloadHash: 'a'.repeat(64), region: 'eu-west-1', credentials, now };
    expect(signV4(base).authorization).toBe(signV4(base).authorization);
    expect(signV4({ ...base, credentials: { ...credentials, secretAccessKey: 'other' } }).authorization).not.toBe(
      signV4(base).authorization,
    );
    expect(signV4({ ...base, payloadHash: 'b'.repeat(64) }).authorization).not.toBe(signV4(base).authorization);
    expect(signV4({ ...base, credentials: { ...credentials, sessionToken: 't' } })['x-amz-security-token']).toBe('t');
  });

  it('encodes per RFC 3986 and decodes XML entities', () => {
    expect(uriEncode("a b/c!'()*~")).toBe('a%20b%2Fc%21%27%28%29%2A~');
    expect(uriEncode('a b/c', true)).toBe('a%20b/c');
    expect(decodeXml('a&amp;b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42;')).toBe('a&b <c> "d" \'e\' AB');
  });
});

describe('S3Storage against the emulator', () => {
  let emulator: S3Emulator;
  beforeAll(async () => {
    emulator = await startS3Emulator({ pageSize: 2 });
  });
  afterAll(async () => {
    await emulator.stop();
  });

  const open = (extra: Partial<ConstructorParameters<typeof S3Storage>[0]> = {}) =>
    new S3Storage({
      bucket: emulator.bucket(),
      region: emulator.region,
      endpoint: emulator.endpoint,
      forcePathStyle: true,
      credentials: emulator.credentials,
      ...extra,
    });

  it('signs every request validly (the emulator answers 403 otherwise)', async () => {
    const storage = open();
    await storage.write('k.txt', 'v');
    await storage.read('k.txt');
    await storage.list();
    await storage.delete('k.txt');
    const bad = open({ credentials: { ...emulator.credentials, secretAccessKey: 'wrong' } });
    await expect(bad.read('k.txt')).rejects.toMatchObject({ status: 403 });
    await expect(bad.write('k.txt', 'v')).rejects.toBeInstanceOf(S3Error);
    const error = await bad.read('k.txt').catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('wrong');
    await expect(open({ region: 'eu-west-1' }).read('k.txt')).rejects.toMatchObject({ status: 403 });
  });

  it('stores keys under the prefix and keeps unrelated prefixes apart', async () => {
    const bucket = emulator.bucket();
    const a = open({ bucket, prefix: '/one/' });
    const b = open({ bucket, prefix: 'two' });
    await a.write('x/y.json', '1');
    await b.write('x/y.json', '22');
    expect((await a.read('x/y.json'))?.toString()).toBe('1');
    expect((await b.list()).map((object) => [object.key, object.size])).toEqual([['x/y.json', 2]]);
    expect(emulator.requests.some((line) => line.includes(`/${bucket}/one/x/y.json`))).toBe(true);
    await expect(a.deletePrefix('x/')).resolves.toBe(1);
    expect(await b.read('x/y.json')).toBeDefined();
  });

  it('handles keys needing escapes and pages through long listings', async () => {
    const storage = open();
    const keys = ['a b/c&d.json', "q/it's (1).txt", 'q/ü.txt', 'z/1', 'z/2', 'z/3', 'z/4', 'z/5'];
    for (const key of keys) await storage.write(key, key);
    const listed = (await storage.list()).map((object) => object.key);
    expect(listed).toEqual([...keys].sort());
    expect((await storage.read('a b/c&d.json'))?.toString()).toBe('a b/c&d.json');
    await expect(storage.list({ prefix: 'z/', glob: 'z/{1,3,5}' })).resolves.toHaveLength(3);
    await expect(storage.list({ prefix: 'q/', glob: 'z/*' })).resolves.toEqual([]);
    expect((await storage.stat('z/1'))?.updatedMs).toBeGreaterThan(0);
  });

  it('maps a missing object to undefined / NotFoundError and uses ETags as versions', async () => {
    const storage = open();
    await expect(storage.stat('nope')).resolves.toBeUndefined();
    await expect(storage.stream('nope')).rejects.toBeInstanceOf(NotFoundError);
    const written = await storage.write('v', 'one');
    expect(written.version).toMatch(/^[0-9a-f]{32}$/);
    expect((await storage.stat('v'))?.version).toBe(written.version);
    expect((await storage.list())[0]?.version).toBe(written.version);
  });

  it('works with virtual-host style URLs through a custom fetcher', async () => {
    const seen: string[] = [];
    const storage = open({
      forcePathStyle: false,
      endpoint: 'https://s3.example.test',
      bucket: 'my-bucket',
      fetcher: async (input) => {
        seen.push(String(input));
        return new Response('', { status: 404 });
      },
    });
    await storage.stat('a/b c.json');
    expect(seen).toEqual(['https://my-bucket.s3.example.test/a/b%20c.json']);
  });

  it('requires credentials and a bucket', () => {
    expect(() => new S3Storage({ bucket: 'b', region: 'r' })).toThrow(/credentials/);
    expect(() => new S3Storage({ bucket: '', region: 'r', credentials: emulator.credentials })).toThrow(/bucket/);
  });
});
