import { BRIDGE_TOOLS, type BridgeTool } from '../../shared/malleable-tools.ts';
import { toolHandlers } from './tools.ts';

/*
 * WebMCP (https://webmachinelearning.github.io/webmcp/, a W3C Web Machine Learning Community Group draft): a page registers
 * tools with `document.modelContext.registerTool({ name, description, inputSchema, execute, annotations })` and a browser-side
 * agent can list and call them in the user's own session. Early builds exposed it as `navigator.modelContext`; the current
 * draft puts it on `document`. Where the browser provides neither, `installWebMcp` installs a small in-page implementation
 * of the same shape (registerTool, getTools, executeTool, ontoolchange), so the tools and the code that serves them are the
 * same everywhere and a real implementation takes over without changes. The out-of-page door (an MCP server for agents that
 * are not in the browser) is bridge.ts + src/mcp/.
 */

interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  annotations?: BridgeTool['annotations'] & { debugging?: boolean };
  execute(input: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown>;
}

interface ModelContextLike {
  readonly polyfill?: boolean;
  registerTool(tool: ToolDefinition, options?: { signal?: AbortSignal }): void | Promise<undefined>;
  getTools?(): Promise<unknown[]>;
  executeTool?(tool: unknown, input?: object | string, options?: { signal?: AbortSignal }): Promise<string>;
}

/** The minimal object we install when the browser has none. Not a full implementation of the draft (no cross-origin exposure). */
class ModelContextPolyfill extends EventTarget implements ModelContextLike {
  readonly polyfill = true;
  private readonly tools = new Map<string, ToolDefinition>();
  ontoolchange: ((event: Event) => void) | null = null;

  async registerTool(tool: ToolDefinition, options: { signal?: AbortSignal } = {}) {
    if (!tool.name || !tool.description) throw new TypeError('a tool needs a name and a description');
    options.signal?.throwIfAborted();
    if (this.tools.has(tool.name)) throw new DOMException(`tool ${tool.name} is already registered`, 'InvalidStateError');
    this.tools.set(tool.name, tool);
    this.changed();
    options.signal?.addEventListener(
      'abort',
      () => {
        if (this.tools.get(tool.name) === tool) {
          this.tools.delete(tool.name);
          this.changed();
        }
      },
      { once: true },
    );
    return undefined;
  }

  async getTools() {
    return [...this.tools.values()].map(({ execute: _execute, ...rest }) => rest);
  }

  async executeTool(tool: { name: string }, input: object | string = {}, options: { signal?: AbortSignal } = {}) {
    options.signal?.throwIfAborted();
    const registered = this.tools.get(tool.name);
    if (!registered) throw new DOMException(`no tool ${tool.name}`, 'NotFoundError');
    let args: unknown;
    try {
      args = typeof input === 'string' ? JSON.parse(input) : input;
    } catch {
      throw new DOMException('tool input must be a JSON object', 'DataError');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new DOMException('tool input must be an object', 'DataError');
    return JSON.stringify(
      await registered.execute(args as Record<string, unknown>, {
        signal: options.signal ?? new AbortController().signal,
      }),
    );
  }

  private changed() {
    const event = new Event('toolchange');
    this.ontoolchange?.(event);
    this.dispatchEvent(event);
  }
}

export function getModelContext(): { context: ModelContextLike; native: boolean } {
  const doc = document as Document & { modelContext?: ModelContextLike };
  const nav = navigator as Navigator & { modelContext?: ModelContextLike };
  const existing = doc.modelContext ?? nav.modelContext;
  if (existing && typeof existing.registerTool === 'function') return { context: existing, native: existing.polyfill !== true };
  const context = new ModelContextPolyfill();
  Object.defineProperty(doc, 'modelContext', { value: context, configurable: true });
  return { context, native: false };
}

let installed: { native: boolean; abort: AbortController; ready: Promise<boolean> } | undefined;

/** Registers the bridge tools with the page's model context. Idempotent. */
export function installWebMcp(): Promise<boolean> {
  if (installed) return installed.ready;
  const { context, native } = getModelContext();
  const abort = new AbortController();
  // The async callback also catches synchronous failures from early navigator implementations.
  const ready = Promise.all(
    BRIDGE_TOOLS.map(async (tool) => {
      await context.registerTool(
        {
          name: tool.name,
          title: tool.name.replaceAll('_', ' '),
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          async execute(input, options) {
            options?.signal?.throwIfAborted();
            const handler = toolHandlers[tool.name];
            if (!handler) throw new Error(`no handler for ${tool.name}`);
            try {
              return await handler(input ?? {});
            } catch (error) {
              // Native WebMCP does not forward thrown error messages to the agent.
              return { error: error instanceof Error ? error.message : 'Tool execution failed' };
            }
          },
        },
        { signal: abort.signal },
      );
    }),
  )
    .then(() => native)
    .catch((error: unknown) => {
      abort.abort();
      if (installed?.abort === abort) installed = undefined;
      throw error;
    });
  installed = { native, abort, ready };
  return ready;
}

export function uninstallWebMcp() {
  installed?.abort.abort();
  installed = undefined;
}
