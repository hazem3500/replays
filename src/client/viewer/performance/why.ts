import type { ReplayInteraction, ReplayInteractionTarget, ReplayLongFrame, ReplayLongFrameScript } from '../../../shared/replay.ts';

/** A long animation frame with its index in the captured track, which interactions point at. */
export interface PerfFrame extends ReplayLongFrame {
  index: number;
}

/** What the recorder captured to explain a slow moment, on the player's clock. */
export interface PerfWhy {
  frames: readonly PerfFrame[];
  /** Undefined when the browser had no Event Timing: the older per-event entries are then the only source. */
  interactions: readonly ReplayInteraction[] | undefined;
}

export const NO_WHY: PerfWhy = { frames: [], interactions: undefined };

export type BreakdownPart = 'inputDelay' | 'processing' | 'presentation';

export const BREAKDOWN_LABELS: Readonly<Record<BreakdownPart, string>> = {
  inputDelay: 'Input delay',
  processing: 'Processing',
  presentation: 'Presentation',
};

export const BREAKDOWN_PARTS: readonly BreakdownPart[] = ['inputDelay', 'processing', 'presentation'];

const VERBS: Readonly<Record<string, string>> = {
  click: 'Clicked',
  pointerdown: 'Clicked',
  pointerup: 'Clicked',
  mousedown: 'Clicked',
  mouseup: 'Clicked',
  auxclick: 'Clicked',
  contextmenu: 'Opened the context menu on',
  touchstart: 'Tapped',
  touchend: 'Tapped',
  keydown: 'Pressed a key on',
  keyup: 'Pressed a key on',
  keypress: 'Pressed a key on',
  input: 'Typed in',
  beforeinput: 'Typed in',
  compositionend: 'Typed in',
};

/** "button 'Plan time'": the role (or tag) and the name where the privacy mode kept it; empty without a target. */
export function describeTarget(target?: ReplayInteractionTarget) {
  if (!target) return '';
  const kind = firstText(target.role, target.tag) ?? '';
  return target.name ? `${kind} '${target.name}'` : kind;
}

/** "Clicked button 'Plan time'", or just the verb phrase when the target is unknown. */
export function interactionSentence(interaction: ReplayInteraction) {
  const verb = VERBS[interaction.eventType] ?? `${interaction.eventType[0]?.toUpperCase() ?? ''}${interaction.eventType.slice(1)} on`;
  const target = describeTarget(interaction.target);
  return target ? `${verb} ${target}` : verb.replace(/ (on|in)$/, '');
}

/** The last path segment of a script URL ("app.js"), the origin for a bare host, "inline" for none. */
export function scriptFileName(sourceURL: string) {
  if (!sourceURL) return 'inline script';
  try {
    const url = new URL(sourceURL);
    const last = url.pathname.split('/').findLast(Boolean);
    return last ?? url.host;
  } catch {
    return sourceURL.split('/').findLast(Boolean) ?? sourceURL;
  }
}

/** The first value that is not empty. */
function firstText(...values: readonly (string | undefined)[]) {
  return values.find((value) => value !== undefined && value !== '');
}

/** The function to name: its own name, else what invoked it, else a placeholder. */
export function scriptFunction(script: ReplayLongFrameScript) {
  return firstText(script.sourceFunctionName, script.invoker) ?? 'anonymous function';
}

/** The tooltip: full URL (origin and path only), the function and what started it. */
export function scriptTitle(script: ReplayLongFrameScript) {
  return [
    firstText(script.sourceURL) ?? 'inline script',
    script.sourceFunctionName && `function ${script.sourceFunctionName}`,
    script.invoker && `started by ${script.invoker}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The time after style and layout began until the frame ended, as ms and a share of the frame; undefined when not reported. */
export function styleLayoutShare(frame: ReplayLongFrame) {
  if (!(frame.styleAndLayoutStart > 0) || frame.styleAndLayoutStart >= frame.duration || !(frame.duration > 0)) return;
  const ms = frame.duration - frame.styleAndLayoutStart;
  return { ms, share: ms / frame.duration };
}

/** Time the frame's scripts spent forcing style and layout. */
export function forcedLayoutTotal(frame: ReplayLongFrame) {
  return frame.scripts.reduce((sum, script) => sum + script.forcedStyleAndLayoutDuration, 0);
}

/** A frame's mark in words: "Long animation frame 240 ms, input blocked for 180 ms". */
export function frameNote(frame: ReplayLongFrame) {
  return frame.blockingDuration > 0 ? `Blocked input for ${Math.round(frame.blockingDuration)} ms` : undefined;
}

export const overlapMs = (a: { at: number; end: number }, b: { at: number; end: number }) => Math.min(a.end, b.end) - Math.max(a.at, b.at);
