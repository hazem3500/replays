import { describe, expect, it } from 'vitest';

import { stepName } from '../src/client/viewer/network/model.ts';
import { summarizeReplay } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

describe('stepName', () => {
  it('drops the host and query from an Open step and leaves other steps alone', () => {
    expect(stepName('Open https://focus.toggl.space/reports/summary?x=1')).toBe('Open /reports/summary');
    expect(stepName('Open https://focus.toggl.space')).toBe('Open /');
    expect(stepName('Clicked “Save”')).toBe('Clicked “Save”');
    expect(stepName('Open the cart')).toBe('Open the cart');
  });
});

describe('first error in the replay summary', () => {
  it('is absent without errors', () => {
    expect(summarizeReplay(replay()).firstError).toBeUndefined();
  });

  it('names the earliest console error, cut to 120 characters', () => {
    const bundle = replay();
    bundle.console = [
      { at: 900, level: 'error', message: 'later' },
      { at: 100, level: 'error', message: `boom ${'x'.repeat(300)}` },
    ];
    const first = summarizeReplay(bundle).firstError;
    expect(first?.kind).toBe('console');
    expect(first?.message).toHaveLength(120);
    expect(first?.message.startsWith('boom')).toBe(true);
  });

  it('names a failed request when it came first', () => {
    const bundle = replay();

    bundle.network = [
      {
        id: 'r1',
        at: 50,
        duration: 10,
        method: 'GET',
        url: 'https://api.test/x',
        status: 500,
        statusText: 'Server Error',
        requestHeaders: [],
        responseHeaders: [],
      },
    ];
    bundle.console = [{ at: 400, level: 'error', message: 'later' }];
    expect(summarizeReplay(bundle).firstError).toEqual({ kind: 'request', message: 'GET https://api.test/x 500' });
  });
});
