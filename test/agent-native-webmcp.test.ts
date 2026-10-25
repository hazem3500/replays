import { describe, expect, it, vi } from 'vitest';
import { createFrameworkClient } from '../examples/agent-native/src/webmcp-client.ts';

function browserContext() {
  const tool = { name: 'inspect', description: 'Inspect the current replay', inputSchema: { type: 'object' } };
  const context = Object.assign(new EventTarget(), {
    registerTool() {},
    getTools: vi.fn<(this: unknown) => Promise<Array<typeof tool>>>(async function (this: unknown) {
      expect(this).toBe(context);
      return [tool];
    }),
    executeTool: vi.fn<(this: unknown, descriptor: unknown, input: unknown, options?: { signal?: AbortSignal }) => Promise<string>>(
      async function (this: unknown, descriptor: unknown, input: unknown, options?: { signal?: AbortSignal }) {
        expect(this).toBe(context);
        expect(descriptor).toBe(tool);
        expect(input).toEqual({ at: 1000 });
        options?.signal?.throwIfAborted();
        return JSON.stringify({ inspected: true });
      },
    ),
  });
  return { context, tool };
}

describe('pinned Agent-Native client and object-input WebMCP', () => {
  it('preserves native descriptor identity, receiver binding and cancellation signal', async () => {
    const { context, tool } = browserContext();
    const target = { modelContext: context } as unknown as Document;
    const client = createFrameworkClient(target)!;
    const controller = new AbortController();
    const result = await client.executeTool({ name: tool.name }, { at: 1000 }, { signal: controller.signal });
    expect(JSON.parse(result as string)).toEqual({ inspected: true });
    expect(context.executeTool).toHaveBeenCalledExactlyOnceWith(tool, { at: 1000 }, { signal: controller.signal });
    expect((target as Document & { modelContext: unknown }).modelContext).toBe(context);
  });

  it('does not retry an execution failure or invoke a tool after cancellation', async () => {
    const { context, tool } = browserContext();
    const client = createFrameworkClient({ modelContext: context } as unknown as Document)!;
    context.executeTool.mockRejectedValueOnce(new Error('Tool failed after a side effect'));
    await expect(client.executeTool(tool, { at: 1000 })).rejects.toThrow('Tool failed after a side effect');
    expect(context.executeTool).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(client.executeTool(tool, { at: 1000 }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(context.executeTool).toHaveBeenCalledTimes(1);
  });

  it('waits for a context before construction and retains tool-change subscription disposal', async () => {
    const target = { modelContext: undefined as unknown };
    expect(createFrameworkClient(target as unknown as Document)).toBeUndefined();
    const { context } = browserContext();
    target.modelContext = context;
    const client = createFrameworkClient(target as unknown as Document)!;
    const listener = vi.fn<() => void>();
    const off = client.onToolChange!(listener);
    context.dispatchEvent(new Event('toolchange'));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    context.dispatchEvent(new Event('toolchange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
