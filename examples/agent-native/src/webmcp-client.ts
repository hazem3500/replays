import { createAgentNativeWebMcpClient } from '@agent-native/core/client/webmcp';

interface ModelContext {
  registerTool(...args: unknown[]): unknown;
  getTools(...args: unknown[]): Promise<unknown[]>;
  executeTool(tool: unknown, input: object, options?: { signal?: AbortSignal }): Promise<unknown>;
  addEventListener?: EventTarget['addEventListener'];
  removeEventListener?: EventTarget['removeEventListener'];
}

function currentContext(target: Document): ModelContext | undefined {
  const doc = target as Document & { modelContext?: ModelContext };
  const nav = target.defaultView?.navigator as (Navigator & { modelContext?: ModelContext }) | undefined;
  const context = doc.modelContext ?? nav?.modelContext;
  return context && [context.registerTool, context.getTools, context.executeTool].every((method) => typeof method === 'function')
    ? context
    : undefined;
}

/** The pinned framework serializes inputs; the current native API requires objects. Adapt only that boundary. */
export function createFrameworkClient(target: Document) {
  // Construct after Replays initializes its context, so the framework subscribes to tool changes even without native WebMCP.
  if (!currentContext(target)) return undefined;
  const adapted = new WeakMap<ModelContext, ModelContext>();
  const facade = {
    get modelContext() {
      const context = currentContext(target);
      if (!context) return undefined;
      let wrapper = adapted.get(context);
      if (!wrapper) {
        wrapper = {
          registerTool: context.registerTool.bind(context),
          // Return the original descriptors and invoke native methods with their actual receiver.
          getTools: context.getTools.bind(context),
          executeTool(tool, input: object | string, options) {
            options?.signal?.throwIfAborted();
            const args: unknown = typeof input === 'string' ? JSON.parse(input) : input;
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Tool input must be an object');
            return context.executeTool(tool, args, options);
          },
          ...(context.addEventListener ? { addEventListener: context.addEventListener.bind(context) } : {}),
          ...(context.removeEventListener ? { removeEventListener: context.removeEventListener.bind(context) } : {}),
        };
        adapted.set(context, wrapper);
      }
      return wrapper;
    },
  };
  // This pinned consumer reads only document.modelContext. Leave the page's real document/context untouched.
  return createAgentNativeWebMcpClient({ document: facade as unknown as Document });
}
