import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CAPTURE_USAGE, parseArgs, runCaptureCli } from '../src/capture/capture.ts';

const root = resolve(import.meta.dirname, '..');
const URL_FLAGS = ['--url', 'https://example.com/shop', '--output', '/tmp/replays-cli-test-output'];

const parse = (...extra: string[]) => parseArgs([...URL_FLAGS, ...extra]);

/** The message a usage error carries, or a marker when the arguments were accepted. */
const usageError = (argv: string[]) =>
  parseArgs(argv).then(
    () => 'the arguments were accepted',
    (error: Error) => error.message,
  );

async function tempFile(name: string, content: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'replays-cli-'));
  const file = join(dir, name);
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

describe('capture arguments: accepted', () => {
  it('applies the defaults', async () => {
    const args = await parse();
    expect(args).toMatchObject({
      url: 'https://example.com/shop',
      output: '/tmp/replays-cli-test-output',
      driver: 'playwright',
      viewport: { width: 1440, height: 900 },
      video: false,
      headed: false,
      steps: [],
      sources: [],
      tags: [],
    });
    expect(args.id).toMatch(/^example-com-\d{4}-\d{2}-\d{2}-\d{6}-[a-f0-9]{6}$/);
    for (const optional of ['title', 'uploadUrl', 'headerFile', 'context', 'contextSchema', 'suiteRun'] as const)
      expect(args).not.toHaveProperty(optional);
  });

  it('reads every option', async () => {
    const steps = JSON.stringify([
      { kind: 'click', selector: '#go' },
      { kind: 'wait', ms: 100 },
    ]);
    const args = await parse(
      '--id',
      'my-capture',
      '--title',
      'My capture',
      '--driver',
      'agent-browser',
      '--viewport',
      '390x844',
      '--video',
      '--headed',
      '--tag',
      'smoke',
      '--tag',
      'checkout',
      '--steps',
      steps,
      '--upload-url',
      'https://replays.example.com/api/replays',
      '--header-file',
      '/tmp/headers.json',
      '--suite-id',
      'nightly',
      '--run-id',
      'Run-7',
    );
    expect(args).toMatchObject({
      id: 'my-capture',
      title: 'My capture',
      driver: 'agent-browser',
      viewport: { width: 390, height: 844 },
      video: true,
      headed: true,
      tags: ['smoke', 'checkout'],
      steps: [
        { kind: 'click', selector: '#go' },
        { kind: 'wait', ms: 100 },
      ],
      uploadUrl: 'https://replays.example.com/api/replays',
      headerFile: '/tmp/headers.json',
      suiteRun: { suiteId: 'nightly', runId: 'Run-7' },
    });
  });

  it('can opt into uploading to a saved server and explicitly start login', async () => {
    await expect(parse('--upload', '--login', '--server', 'staging')).resolves.toMatchObject({
      upload: true,
      login: true,
      serverName: 'staging',
    });
    await expect(usageError([...URL_FLAGS, '--login'])).resolves.toBe('--login requires --upload or --upload-url');
  });

  it('accepts http only for localhost', async () => {
    for (const host of ['localhost:5173', '127.0.0.1:4173', '[::1]:8080'])
      await expect(parseArgs(['--url', `http://${host}/`, '--output', '/tmp/x'])).resolves.toMatchObject({ url: `http://${host}/` });
  });

  it('reads steps from a file with @', async () => {
    const file = await tempFile('steps.json', [{ kind: 'press', key: 'Enter' }]);
    await expect(parse('--steps', `@${file}`)).resolves.toMatchObject({ steps: [{ kind: 'press', key: 'Enter' }] });
  });

  it('turns --source flags into inputs, in order, and ignores a bare --', async () => {
    const args = await parse(
      '--',
      '--source',
      'github:example-org/shop-demo#42',
      '--source',
      'url:https://tickets.example.com/browse/SHOP-7',
    );
    expect(args.sources).toEqual([
      { provider: 'github', ref: 'example-org/shop-demo#42' },
      { provider: 'url', ref: 'https://tickets.example.com/browse/SHOP-7' },
    ]);
  });

  it('reads a context file and checks it against a schema file', async () => {
    const context = await tempFile('context.json', { app: { name: 'Shop Demo' }, fields: { feature: 'coupons' } });
    const schema = await tempFile('schema.json', { type: 'object', properties: { feature: { type: 'string', enum: ['coupons'] } } });
    const args = await parse('--context-file', context, '--context-schema', schema);
    expect(args.context).toEqual({ app: { name: 'Shop Demo' }, fields: { feature: 'coupons' } });
    expect(args.contextSchema).toMatchObject({ type: 'object' });
  });
});

describe('capture arguments: usage errors', () => {
  it('requires --url and --output', async () => {
    await expect(await usageError([])).toMatch('required: --url <https-url>');
    await expect(await usageError(['--output', '/tmp/x'])).toMatch('required: --url <https-url>');
    await expect(await usageError(['--url', 'https://example.com/'])).toMatch('required: --output <directory>');
  });

  it('refuses http for anything but localhost, and other schemes', async () => {
    for (const url of [
      'http://example.com/',
      'http://192.168.1.10:8080/',
      'http://localhost.example.com/',
      'ftp://example.com/',
      'file:///etc/passwd',
    ])
      await expect(await usageError(['--url', url, '--output', '/tmp/x'])).toMatch('--url must use https (http only for localhost)');
    await expect(await usageError(['--url', 'not a url', '--output', '/tmp/x'])).toMatch(/Invalid URL/);
  });

  it('refuses a bad driver', async () => {
    await expect(await usageError([...URL_FLAGS, '--driver', 'selenium'])).toMatch('--driver must be playwright or agent-browser');
  });

  it('refuses a bad viewport', async () => {
    for (const viewport of ['1440', '1440x', 'x900', '10x10', '1440X900', '1440 x 900', '123456x900', 'wide'])
      await expect(await usageError([...URL_FLAGS, '--viewport', viewport])).toMatch('--viewport must look like 1440x900');
  });

  it('refuses bad tags', async () => {
    await expect(await usageError([...URL_FLAGS, '--tag', 'Not A Tag'])).toMatch(/--tag entries must be 1-40 characters/);
    await expect(await usageError([...URL_FLAGS, '--tag', '-leading-dash'])).toMatch(/--tag entries must be/);
    await expect(await usageError([...URL_FLAGS, '--tag', 'x'.repeat(41)])).toMatch(/--tag entries must be/);
    await expect(await usageError([...URL_FLAGS, ...Array.from({ length: 11 }, (_, i) => ['--tag', `tag-${i}`]).flat()])).toMatch(
      '--tag must be an array of at most 10 entries',
    );
  });

  it('refuses a bad --source', async () => {
    await expect(await usageError([...URL_FLAGS, '--source', 'justareference'])).toMatch(
      '--source must look like <provider>:<reference>, e.g. github:owner/repo#12',
    );
    await expect(await usageError([...URL_FLAGS, '--source', 'github:'])).toMatch(/--source must look like/);
    await expect(await usageError([...URL_FLAGS, '--source', ':example-org/shop-demo#42'])).toMatch(/--source must look like/);
    await expect(await usageError([...URL_FLAGS, '--source', 'jira:SHOP-7'])).toMatch(
      'context.sources[0].provider must be one of github, gitlab, url',
    );
    await expect(await usageError([...URL_FLAGS, '--source', 'github:not-a-reference'])).toMatch(
      'context.sources[0].ref is not a valid GitHub reference',
    );
    await expect(await usageError([...URL_FLAGS, '--source', 'url:http://tickets.example.com/1'])).toMatch(
      'context.sources[0].ref is not a valid Link reference',
    );
  });

  it('needs --suite-id and --run-id together, and a plain run id', async () => {
    await expect(await usageError([...URL_FLAGS, '--suite-id', 'nightly'])).toMatch('--suite-id and --run-id must be used together');
    await expect(await usageError([...URL_FLAGS, '--run-id', 'run-1'])).toMatch('--suite-id and --run-id must be used together');
    await expect(await usageError([...URL_FLAGS, '--suite-id', 'nightly', '--run-id', '-bad'])).toMatch(
      '--run-id must contain letters, digits, and hyphens',
    );
    await expect(await usageError([...URL_FLAGS, '--suite-id', 'Not A Suite', '--run-id', 'run-1'])).toMatch(/replay id must contain/);
  });

  it('refuses a bad id, a flag without a value and stray arguments', async () => {
    await expect(await usageError([...URL_FLAGS, '--id', 'Bad Id'])).toMatch(/replay id must contain lowercase letters/);
    await expect(await usageError(['--url'])).toMatch('--url takes a value');
    await expect(await usageError([...URL_FLAGS, '--title', '--video'])).toMatch('--title takes a value');
    await expect(await usageError([...URL_FLAGS, 'stray'])).toMatch('unexpected argument: stray');
  });

  it('refuses bad steps before any browser starts', async () => {
    await expect(await usageError([...URL_FLAGS, '--steps', '{"kind":"click"}'])).toMatch('--steps must be a JSON array');
    await expect(await usageError([...URL_FLAGS, '--steps', '[{"kind":"click"}]'])).toMatch(
      '--steps[0].selector must be a non-empty string',
    );
    await expect(await usageError([...URL_FLAGS, '--steps', '[{"kind":"eval","code":"1"}]'])).toMatch(
      '--steps[0].kind is unsupported: eval',
    );
    await expect(await usageError([...URL_FLAGS, '--steps', '[{"kind":"goto","url":"http://example.com"}]'])).toMatch(
      '--steps[0].url must use https',
    );
    await expect(await usageError([...URL_FLAGS, '--steps', '[not json'])).toMatch(/JSON/);
  });

  it('refuses a context that does not satisfy the schema, or has unsupported keys', async () => {
    const schema = await tempFile('schema.json', { type: 'object', required: ['feature'], properties: { feature: { type: 'string' } } });
    const noFeature = await tempFile('context.json', { fields: { other: 1 } });
    await expect(await usageError([...URL_FLAGS, '--context-file', noFeature, '--context-schema', schema])).toMatch(
      "context.fields must have required property 'feature'",
    );
    const unsupported = await tempFile('context-bad.json', { account: { id: 1 } });
    await expect(await usageError([...URL_FLAGS, '--context-file', unsupported])).toMatch('the context file has unsupported keys: account');
  });
});

describe('runCaptureCli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints the usage for --help and -h without starting anything', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCaptureCli(['--help']);
    await runCaptureCli(['-h']);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0]![0]).toBe(`${CAPTURE_USAGE}\n`);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a usage error as one JSON line on stderr and exits with 1', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runCaptureCli(['--url', 'http://example.com/', '--output', '/tmp/x']);
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]![0]);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ success: false, error: '--url must use https (http only for localhost)' });
    expect(process.exitCode).toBe(1);
  });
});

const run = (...args: string[]) =>
  spawnSync(process.execPath, [join(root, 'bin/replays.mjs'), ...args], { encoding: 'utf8', cwd: tmpdir() });
const runSource = (...args: string[]) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'src/cli.ts'), ...args], {
    encoding: 'utf8',
    cwd: tmpdir(),
  });

describe('the replays command', () => {
  it.each([
    ['bin/replays.mjs', run],
    ['src/cli.ts', runSource],
  ])('%s --help lists the commands', (_name, invoke) => {
    for (const flag of ['--help', '-h', 'help']) {
      const result = invoke(flag);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('replays <command> [options]');
      for (const command of ['capture', 'import', 'upload', 'connect', 'config', 'doctor', 'login', 'status', 'logout', 'serve'])
        expect(result.stdout).toMatch(new RegExp(`^  ${command}\\s`, 'm'));
    }
    expect(invoke().stdout).toContain('Commands:');
  });

  it.each([
    ['bin/replays.mjs', run],
    ['src/cli.ts', runSource],
  ])('%s capture --help prints the capture options', (_name, invoke) => {
    const result = invoke('capture', '--help');
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd()).toBe(CAPTURE_USAGE);
    for (const option of [
      '--url',
      '--output',
      '--steps',
      '--driver',
      '--viewport',
      '--tag',
      '--source',
      '--context-file',
      '--context-schema',
      '--suite-id',
      '--run-id',
      '--upload-url',
    ])
      expect(result.stdout).toContain(option);
  });

  it.each([
    ['bin/replays.mjs', run],
    ['src/cli.ts', runSource],
  ])('%s refuses an unknown command with status 2', (_name, invoke) => {
    const result = invoke('frobnicate');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown command: frobnicate');
    expect(result.stderr).toContain('Commands:');
  });

  it('reports a capture usage error as JSON on stderr with status 1', () => {
    const result = runSource('capture', '--url', 'http://example.com/', '--output', '/tmp/x');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ success: false, error: '--url must use https (http only for localhost)' });
    expect(result.stdout).toBe('');
  });

  it('reports upload and import usage errors the same way', () => {
    const upload = runSource('upload');
    expect(upload.status).toBe(1);
    expect(JSON.parse(upload.stderr).error).toMatch(/^usage: replays upload <replay\.json>/);
    const importer = runSource('import', '--rrweb', 'events.json');
    expect(importer.status).toBe(1);
    expect(JSON.parse(importer.stderr)).toEqual({ success: false, error: '--title is required' });
  });
});
