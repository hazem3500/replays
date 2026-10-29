import { describe, expect, it } from 'vitest';
import { ViewerRegistry } from '../src/client/plugins/api.ts';

describe('plugin activity subscriptions', () => {
  it('delivers only immutable activity metadata to a plugin', () => {
    const registry = new ViewerRegistry();
    const received: unknown[] = [];
    registry.apiFor('analytics').on('seek', (event) => received.push(event));
    const event = { type: 'seek' as const, replayId: 'recording', timeMs: 350, title: 'Private title', url: 'https://private.test' };
    registry.emitEvent(event);
    expect(received).toEqual([{ replayId: 'recording', timeMs: 350 }]);
    expect(Object.isFrozen(received[0])).toBe(true);
  });

  it('keeps notifying other plugins when an observer throws', () => {
    const registry = new ViewerRegistry();
    const received: number[] = [];
    registry.apiFor('broken').on('seek', () => {
      throw new Error('failed');
    });
    registry.apiFor('working').on('seek', (event) => received.push(event.timeMs));
    registry.emitEvent({ type: 'seek', replayId: 'recording', timeMs: 100 });
    expect(received).toEqual([100]);
  });

  it('removes only the unloaded plugin and supports explicit unsubscribe', () => {
    const registry = new ViewerRegistry();
    const received: string[] = [];
    registry.apiFor('removed').on('seek', () => received.push('removed'));
    const unsubscribe = registry.apiFor('temporary').on('seek', () => received.push('temporary'));
    registry.apiFor('kept').on('seek', () => received.push('kept'));
    registry.removePlugin('removed');
    unsubscribe();
    registry.emitEvent({ type: 'seek', replayId: 'recording', timeMs: 100 });
    expect(received).toEqual(['kept']);
  });

  it('restores the previous observer when a replacement fails', () => {
    const registry = new ViewerRegistry();
    const received: string[] = [];
    registry.apiFor('host').on('seek', () => received.push('old'));
    const replacementObserver = () => received.push('new');
    const replacement = (api: ReturnType<ViewerRegistry['apiFor']>) => {
      api.on('seek', replacementObserver);
      throw new Error('bad reload');
    };
    expect(() => registry.replacePlugin('host', replacement)).toThrow('bad reload');
    registry.emitEvent({ type: 'seek', replayId: 'recording', timeMs: 100 });
    expect(received).toEqual(['old']);
  });

  it('lets late-loading plugins observe active replays without retaining closed ones', () => {
    const registry = new ViewerRegistry();
    const close = registry.openReplay('recording');
    const received: string[] = [];
    registry.apiFor('host').on('replay:open', ({ replayId }) => received.push(replayId));
    registry.apiFor('host').on('replay:open', ({ replayId }) => received.push(`second:${replayId}`));
    close();
    registry.apiFor('later').on('replay:open', ({ replayId }) => received.push(`late:${replayId}`));
    expect(received).toEqual(['recording', 'second:recording']);
  });

  it('refuses sandboxed plugins the host activity surface', () => {
    const registry = new ViewerRegistry();
    const observer = () => {};
    expect(() => registry.apiFor('user:draft').on('seek', observer)).toThrow('only host plugins');
  });
});
