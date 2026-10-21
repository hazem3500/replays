import type { Owned } from '../plugin/registry.ts';
import type { RenderedFile, RenderHooks, RenderJob, RenderJobOptions } from '../plugin/types.ts';
import type { PosterMoment } from '../shared/purposes.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { RENDER_SPEED_OPTIONS } from './render-queue.ts';
import type { PosterChoice } from './store.ts';

/*
 * The run-time half of `api.render` (src/plugin/types.ts RenderHooks): the poster's moment, the check before each
 * render and the call after each stored file. The queues (render-queue.ts, posters.ts) and the render routes call
 * these; they never see the hooks themselves.
 */

/** What `beforeRender` decided: the options to render with, or why the job is refused. */
export type RenderVerdict = { ok: true; options: RenderJobOptions } | { ok: false; plugin: string; error: string };

/** The options a `beforeRender` hook may change, and how each is checked. Anything else is ignored (and logged once). */
const ADJUSTABLE: Record<keyof RenderJobOptions, (value: unknown) => boolean> = {
  speed: (value) => RENDER_SPEED_OPTIONS.includes(value as never),
  captions: (value) => typeof value === 'boolean',
  skipInactive: (value) => typeof value === 'boolean',
};

/** A poster chooser link: a moment, or undefined to pass to the next one. */
type PosterLink = (input: {
  purpose: string | undefined;
  bundle: () => Promise<ReplayBundle | undefined>;
}) => Promise<PosterChoice | undefined>;

/** What hooks receive: a frozen copy, so one cannot change what the next one or the queue sees. */
const view = (job: RenderJob, options: RenderJobOptions): RenderJob => Object.freeze({ ...job, options: Object.freeze({ ...options }) });

export interface RenderHookRunner {
  /** True when some plugin registered `beforeRender` (callers skip building jobs otherwise). */
  readonly checks: boolean;
  /** True when some plugin registered `afterRender`. */
  readonly notifies: boolean;
  /** `beforeRender` hooks in plugin order. The first `false` (or throw) refuses; option changes accumulate. */
  beforeRender(job: RenderJob): Promise<RenderVerdict>;
  /** `afterRender` hooks in plugin order; each one's errors are logged and never reach the caller. */
  afterRender(job: RenderJob, file: RenderedFile): Promise<void>;
  /**
   * Where a replay's poster is taken: the `posterAt` hooks in plugin order (the first finite number wins), then the
   * purpose's `poster` setting, then the default (`undefined`). One chain: the purpose setting is its last link.
   * Memoised per replay (a bundle never changes; a deploy restarts the process). Undefined when nothing can
   * choose, so a deployment without hooks or poster settings never loads a bundle or summary for it.
   */
  posterChooser(options: {
    /** The replay's purpose (explicit or inferred), from its summary. */
    purpose: (id: string) => Promise<string | undefined>;
    /** A purpose's `poster` setting (PurposeCatalog.poster); absent when no purpose sets one. */
    purposePoster?: ((purpose: string | undefined) => PosterMoment | undefined) | undefined;
    load: (id: string) => Promise<ReplayBundle | undefined>;
    /** Remembered answers; the oldest is dropped beyond this. */
    max?: number;
  }): ((id: string) => Promise<PosterChoice | undefined>) | undefined;
}

export function createRenderHooks(
  hooks: readonly Owned<RenderHooks>[],
  log: (line: string) => void = (line) => console.error(line),
): RenderHookRunner {
  const warned = new Set<string>();
  const warnOnce = (plugin: string, message: string) => {
    const line = `plugin ${plugin}: ${message}`;
    if (warned.has(line)) return;
    warned.add(line);
    log(line);
  };
  const failed = (plugin: string, what: string, error: unknown) =>
    log(`plugin ${plugin}: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  const before = hooks.filter((hook) => hook.value.beforeRender);
  const after = hooks.filter((hook) => hook.value.afterRender);
  const posterAt = hooks.filter((hook) => hook.value.posterAt);

  return {
    checks: before.length > 0,
    notifies: after.length > 0,

    async beforeRender(job) {
      let options: RenderJobOptions = { ...job.options };
      for (const hook of before) {
        let result: unknown;
        try {
          result = await hook.value.beforeRender!(view(job, options));
        } catch (error) {
          // A check that cannot run refuses: failing open would let a policy hook's bug skip the policy.
          failed(hook.plugin, 'beforeRender', error);
          return { ok: false, plugin: hook.plugin, error: `the ${job.kind === 'video' ? 'export' : job.kind} check failed` };
        }
        if (result === false)
          return { ok: false, plugin: hook.plugin, error: `this ${job.kind === 'video' ? 'export' : job.kind} is not allowed here` };
        if (result === undefined || result === null || result === true) continue;
        if (typeof result !== 'object' || Array.isArray(result)) {
          warnOnce(hook.plugin, 'beforeRender must return nothing, false or some options; ignored');
          continue;
        }
        const changes: RenderJobOptions = {};
        for (const [name, value] of Object.entries(result)) {
          const check = Object.hasOwn(ADJUSTABLE, name) ? ADJUSTABLE[name as keyof RenderJobOptions] : undefined;
          if (job.kind !== 'video' || !check)
            warnOnce(hook.plugin, `beforeRender: ${job.kind} jobs have no option ${JSON.stringify(name)}; ignored`);
          else if (value === undefined) continue;
          else if (!check(value)) warnOnce(hook.plugin, `beforeRender: ${name} cannot be ${JSON.stringify(value)}; ignored`);
          else Object.assign(changes, { [name]: value });
        }
        options = { ...options, ...changes };
      }
      return { ok: true, options };
    },

    async afterRender(job, file) {
      for (const hook of after) {
        try {
          await hook.value.afterRender!(view(job, job.options), Object.freeze({ ...file }));
        } catch (error) {
          failed(hook.plugin, 'afterRender', error);
        }
      }
    },

    posterChooser({ purpose, purposePoster, load, max = 2000 }) {
      const links: PosterLink[] = posterAt.map((hook) => async (input) => {
        const bundle = await input.bundle();
        if (!bundle) return undefined;
        let at: unknown;
        try {
          at = await hook.value.posterAt!(bundle, input.purpose === undefined ? {} : { purpose: input.purpose });
        } catch (error) {
          failed(hook.plugin, 'posterAt', error);
          return undefined;
        }
        if (at === undefined || at === null) return undefined;
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
          warnOnce(
            hook.plugin,
            `posterAt must return a time in ms (>= 0) or undefined; got ${typeof at === 'number' ? at : JSON.stringify(at)}`,
          );
          return undefined;
        }
        return at;
      });
      // The built-in fallback: the purpose's `poster` setting is sugar for a last `posterAt`.
      if (purposePoster) links.push(async (input) => purposePoster(input.purpose));
      if (!links.length) return undefined;

      const remembered = new Map<string, Promise<PosterChoice | undefined>>();
      const choose = async (id: string) => {
        const replayPurpose = await purpose(id);
        let bundle: Promise<ReplayBundle | undefined> | undefined;
        const input = { purpose: replayPurpose, bundle: () => (bundle ??= load(id)) };
        for (const link of links) {
          const choice = await link(input);
          if (choice !== undefined) return choice;
        }
        return undefined;
      };
      return (id) => {
        const known = remembered.get(id);
        if (known) return known;
        const answer = choose(id);
        remembered.set(id, answer);
        // A failed lookup (storage hiccup) is not remembered: the next request asks again.
        answer.catch(() => remembered.delete(id));
        if (remembered.size > max) remembered.delete(remembered.keys().next().value!);
        return answer;
      };
    },
  };
}
