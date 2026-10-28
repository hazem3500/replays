import { describe, expect, it } from 'vitest';

import { defineRoute, RouteTable } from '../src/server/http/route.ts';

const ok = () => new Response('ok');

describe('route table', () => {
  const table = new RouteTable([
    defineRoute({ method: 'GET', path: '/api/replays', handler: ok }),
    defineRoute({ method: ['PUT', 'DELETE'], path: '/api/replays/:id/keep', params: { id: /[a-z0-9][a-z0-9-]{0,79}/ }, handler: ok }),
  ]);

  it('matches by method and exact, base-stripped path', () => {
    expect(table.match('GET', '/api/replays')?.route.path).toBe('/api/replays');
    expect(table.match('get', '/api/replays')).toBeDefined();
    expect(table.match('POST', '/api/replays')).toBeUndefined();
    expect(table.match('GET', '/api/replays/')).toBeUndefined();
  });

  it('checks path parameters against their patterns in full', () => {
    expect(table.match('PUT', '/api/replays/demo-1/keep')?.params).toEqual({ id: 'demo-1' });
    expect(table.match('DELETE', '/api/replays/demo-1/keep')).toBeDefined();
    expect(table.match('PUT', '/api/replays/Demo/keep')).toBeUndefined();
    expect(table.match('PUT', '/api/replays/-x/keep')).toBeUndefined();
  });

  it('takes routes added at runtime', () => {
    const runtime = new RouteTable();
    expect(runtime.match('POST', '/api/intake')).toBeUndefined();
    runtime.add(defineRoute({ method: 'POST', path: '/api/intake', handler: ok }));
    expect(runtime.match('POST', '/api/intake')).toBeDefined();
  });
});
