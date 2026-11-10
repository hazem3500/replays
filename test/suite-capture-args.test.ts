import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/capture/capture.ts';
import { captureArgv } from '../src/suite/record-capture.ts';
import { parsePlan } from '../src/suite/plan.ts';

const plan = parsePlan({
  id: 'review-1',
  title: 'Review',
  profile: 'design-review',
  source: 'github:example-org/shop#4',
  runs: [
    {
      id: 'Phone-1',
      title: 'Phone',
      url: 'https://example.com/shop',
      viewport: { width: 390, height: 844 },
      steps: [{ kind: 'click', selector: '#go', label: 'Go' }],
    },
  ],
});

describe('capture arguments for a plan run', () => {
  it('are the ones the capture command itself accepts, attached to the suite run', async () => {
    const run = plan.runs[0]!;
    const args = await parseArgs(captureArgv(plan, run, '/tmp/out/Phone-1', 'review-1-phone-1', { tags: ['nightly'], video: true }));
    expect(args).toMatchObject({
      url: 'https://example.com/shop',
      output: '/tmp/out/Phone-1',
      id: 'review-1-phone-1',
      title: 'Phone',
      viewport: { width: 390, height: 844 },
      steps: [{ kind: 'click', selector: '#go', label: 'Go' }],
      suiteRun: { suiteId: 'review-1', runId: 'Phone-1' },
      profile: 'design-review',
      tags: ['nightly'],
      video: true,
    });
    expect(args.sources).toEqual([{ provider: 'github', ref: 'example-org/shop#4' }]);
    expect(args.upload).toBeUndefined();
  });
});
