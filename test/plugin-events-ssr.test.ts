import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ReplayController } from '../src/client/player.ts';
import { usePluginEvents } from '../src/client/hooks/use-plugin-events.ts';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { replay } from './fixtures.ts';

function ViewerLifecycle() {
  const player = new ReplayController(replay());
  usePluginEvents('recording', 'network', player);
  return createElement('span', null, 'Replay');
}

afterEach(() => viewerRegistry.reset());

describe('plugin activity during server rendering', () => {
  it('renders without browser globals or publishing activity from another request', () => {
    const received: unknown[] = [];
    viewerRegistry.apiFor('host').on('replay:open', (event) => received.push(event));
    viewerRegistry.apiFor('host').on('tab:change', (event) => received.push(event));
    expect(renderToString(createElement(ViewerLifecycle))).toContain('Replay');
    expect(renderToString(createElement(ViewerLifecycle))).toContain('Replay');
    viewerRegistry.apiFor('later').on('replay:open', (event) => received.push(event));
    expect(received).toEqual([]);
  });
});
