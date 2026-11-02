import { describe, expect, it } from 'vitest';

import { captureHelp } from '../src/client/viewer/capture-help.ts';

describe('capture help', () => {
  it('tells a recorder replay the option that keeps bodies, with the command line as the alternative', () => {
    const help = captureHelp('bodies', 'human', 'https://shop.example/cart');
    expect(help.snippet).toBe("capture: { network: 'bodies' }");
    expect(help.cli).toBe('replays capture https://shop.example/cart --network bodies');
  });

  it('sends a recorder replay to the command line for performance, which the recorder never records', () => {
    const help = captureHelp('performance', 'human', 'https://shop.example/cart');
    expect(help.snippet).toBe('replays capture https://shop.example/cart');
    expect(help.cli).toBeUndefined();
  });

  it('tells an agent capture to run again without --no-performance, for the page it recorded', () => {
    const help = captureHelp('performance', 'agent', 'https://shop.example/cart');
    expect(help.how).toContain('--no-performance');
    expect(help.snippet).toBe('replays capture https://shop.example/cart');
  });

  it('keeps a placeholder when the recording has no page address', () => {
    expect(captureHelp('bodies', 'agent', '').snippet).toBe('replays capture <url> --network bodies');
  });
});
