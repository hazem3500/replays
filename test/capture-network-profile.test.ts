import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/capture/capture.ts';
import { DEFAULT_PROFILE_IDS, unknownProfileWarning } from '../src/capture/capture-settings.ts';

const argv = ['--url', 'https://example.com', '--output', '/tmp/replays-unused'];

const collect = (into: string[]) => (chunk: string | Uint8Array) => {
  into.push(String(chunk));
  return true;
};

describe('--profile warnings', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(DEFAULT_PROFILE_IDS)('accepts %s without a declaration', (id) => {
    expect(unknownProfileWarning(id, {})).toBeUndefined();
  });

  it('accepts a declared id and the built-in performance profile', () => {
    expect(unknownProfileWarning('nightly', { config: [{ id: 'nightly', label: 'Nightly' }] })).toBeUndefined();
    expect(unknownProfileWarning('performance', {})).toBeUndefined();
  });

  it('warns only for an unknown id, with the ids to use instead', () => {
    const warning = unknownProfileWarning('triag', { config: [{ id: 'nightly', label: 'Nightly' }] });
    expect(warning).toContain('profile triag is not declared; declare it in replays.config.* or use one of:');
    expect(warning).toContain('nightly');
    expect(warning).toContain('triage, design-review, walkthrough, support');
  });

  it('parseArgs stays silent for a built-in id', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(collect(written));
    await parseArgs([...argv, '--profile', 'triage']);
    expect(written.join('')).not.toContain('not declared');
  });
});
