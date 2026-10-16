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
  registerTool(tool: ToolDefinition, options?: { signal?: AbortSignal }): Promise<undefined>;
  getTools?(): Promise<unknown[]>;
  executeTool?(tool: unknown, input?: object): Promise<string>;
}

/** The minimal object we install when the browser has none. Not a full implementation of the draft (no cross-origin exposure). */
class ModelContextPolyfill extends EventTarget implements ModelContextLike {
  readonly polyfill = true;
  private readonly tools = new Map<string, ToolDefinition>();
  ontoolchange: ((event: Event) => void) | null = null;

  async registerTool(tool: ToolDefinition, options: { signal?: AbortSignal } = {}) {
    if (!tool.name || !tool.description) throw new TypeError('a tool needs a name and a description');
    if (this.tools.has(tool.name)) throw new DOMException(`tool ${tool.name} is already registered`, 'InvalidStateError');
    this.tools.set(tool.name, tool);
    this.changed();
    options.signal?.addEventListener('abort', () => {
      this.tools.delete(tool.name);
      this.changed();
    });
    return undefined;
  }

  async getTools() {
    return [...this.tools.values()].map(({ execute: _execute, ...rest }) => rest);
  }

  async executeTool(tool: { name: string }, input: object = {}) {
    const registered = this.tools.get(tool.name);
    if (!registered) throw new DOMException(`no tool ${tool.name}`, 'NotFoundError');
    return JSON.stringify(await registered.execute(input as Record<string, unknown>, { signal: new AbortController().signal }));
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
  const native = doc.modelContext ?? nav.modelContext;
  if (native) return { context: native, native: true };
  const context = new ModelContextPolyfill();
  Object.defineProperty(doc, 'modelContext', { value: context, configurable: true });
  return { context, native: false };
}

let installed: { native: boolean; abort: AbortController } | undefined;

/** Registers the bridge tools with the page's model context. Idempotent. */
export async function installWebMcp() {
  if (installed) return installed.native;
  const { context, native } = getModelContext();
  const abort = new AbortController();
  installed = { native, abort };
  await Promise.all(
    BRIDGE_TOOLS.map((tool) =>
      context
        .registerTool(
          {
            name: tool.name,
            title: tool.name.replaceAll('_', ' '),
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            async execute(input) {
              const handler = toolHandlers[tool.name];
              if (!handler) throw new Error(`no handler for ${tool.name}`);
              return await handler(input ?? {});
            },
          },
          { signal: abort.signal },
        )
        .catch((error: unknown) => console.warn(`WebMCP: could not register ${tool.name}:`, error)),
    ),
  );
  return native;
}

export function uninstallWebMcp() {
  installed?.abort.abort();
  installed = undefined;
}
