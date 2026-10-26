import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/client/malleable/tools.ts', () => ({
  toolHandlers: {
    get_app_state: vi.fn<(input: Record<string, unknown>) => unknown>((input) => ({ input })),
    seek: vi.fn<() => never>(() => {
      throw new Error('ms must be a non-negative number');
    }),
  },
}));
import { BRIDGE_TOOLS } from '../src/shared/malleable-tools.ts';
import { getModelContext, installWebMcp, uninstallWebMcp } from '../src/client/malleable/webmcp.ts';

beforeEach(() => {
  vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', {});
});
afterEach(() => {
  uninstallWebMcp();
  vi.unstubAllGlobals();
});

describe('WebMCP producer and local stand-in', () => {
  it('reuses its stand-in without claiming native support, including after uninstall', async () => {
    expect(await installWebMcp()).toBe(false);
    expect(getModelContext().native).toBe(false);
    uninstallWebMcp();
    expect(await getModelContext().context.getTools!()).toEqual([]);
    expect(await installWebMcp()).toBe(false);
    expect(await getModelContext().context.getTools!()).toHaveLength(BRIDGE_TOOLS.length);
  });

  it('accepts object and framework JSON-string arguments and rejects non-object inputs', async () => {
    await installWebMcp();
    const context = getModelContext().context;
    const tool = { name: 'get_app_state' };
    expect(JSON.parse(await context.executeTool!(tool, '{"part":"console"}'))).toEqual({ input: { part: 'console' } });
    expect(JSON.parse(await context.executeTool!(tool, { part: 'steps' }))).toEqual({ input: { part: 'steps' } });
    for (const input of ['null', '[]', '1', '{bad'])
      await expect(context.executeTool!(tool, input)).rejects.toMatchObject({ name: 'DataError' });
    const controller = new AbortController();
    controller.abort();
    await expect(context.executeTool!(tool, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(JSON.parse(await context.executeTool!({ name: 'seek' }, { ms: -1 }))).toEqual({ error: 'ms must be a non-negative number' });
  });

  it('does not register a tool whose lifecycle signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const context = getModelContext().context;
    await expect(
      context.registerTool({ name: 'x', description: 'x', execute: async () => ({}) }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await context.getTools!()).toEqual([]);
  });

  it('supports synchronous legacy registration and rolls back a failed installation for retry', async () => {
    const registerTool = vi.fn<(tool: unknown, options: { signal: AbortSignal }) => void>();
    vi.stubGlobal('navigator', { modelContext: { registerTool } });
    expect(await installWebMcp()).toBe(true);
    expect(registerTool).toHaveBeenCalledTimes(BRIDGE_TOOLS.length);
    uninstallWebMcp();
    let signal: AbortSignal | undefined;
    registerTool.mockImplementation((_tool, options) => {
      signal = options.signal;
      throw new Error('registration refused');
    });
    await expect(installWebMcp()).rejects.toThrow('registration refused');
    expect(signal?.aborted).toBe(true);
    registerTool.mockImplementation(() => undefined);
    expect(await installWebMcp()).toBe(true);
  });

  it('shares registration completion between concurrent callers', async () => {
    let complete!: () => void;
    const pending = new Promise<undefined>((resolve) => {
      complete = () => resolve(undefined);
    });
    vi.stubGlobal('document', { modelContext: { registerTool: () => pending } });
    const first = installWebMcp();
    expect(installWebMcp()).toBe(first);
    complete();
    expect(await first).toBe(true);
  });
});
