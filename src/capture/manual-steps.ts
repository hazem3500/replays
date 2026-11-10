import { FOLD_MS, routeNameOf } from '../recorder/interaction-steps.ts';
import type { ReplayStep } from '../shared/replay.ts';

/** A top-level page load the browser made after the first one, as the recorder session saw it (`at` is an epoch). */
export interface PageLoad {
  at: number;
  url: string;
}

function loadLabel(url: string): string {
  try {
    const page = routeNameOf(new URL(url));
    return page ? `Opened ${page}` : 'Navigated';
  } catch {
    return 'Navigated';
  }
}

/**
 * The steps of a manual recording: the in-page ones (clicks, form submits, route changes; named by the in-app
 * recorder's own code) plus a step for each full page load, in time order. A page load right after a click is folded
 * into that click ("Clicked “Pricing”" becomes "Opened “Pricing”"), as the in-app recorder does for route changes.
 * `at` stays an epoch; the caller moves it onto the replay clock.
 */
export function deriveManualSteps(inPage: readonly ReplayStep[], loads: readonly PageLoad[]): ReplayStep[] {
  const steps = inPage.map((step) => ({ ...step }));
  const claimed = new Set<ReplayStep>();
  for (const load of [...loads].sort((a, b) => a.at - b.at)) {
    const click = steps
      .filter((step) => step.kind === 'click' && !claimed.has(step) && step.at <= load.at && load.at - step.at <= FOLD_MS)
      .at(-1);
    const clicked = click ? /^Clicked “(.+)”$/su.exec(click.label)?.[1] : undefined;
    if (click) {
      claimed.add(click);
      if (clicked) click.label = `Opened “${clicked}”`;
      else if (loadLabel(load.url) !== 'Navigated') click.label = loadLabel(load.url);
      continue;
    }
    steps.push({ at: load.at, kind: 'navigate', label: loadLabel(load.url), auto: true });
  }
  return steps.sort((a, b) => a.at - b.at);
}
