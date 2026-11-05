/** Each step kind's name, shared by the step rail, the timeline's dots and the clip's short steps. */
export const STEP_KIND_NAMES = {
  click: 'Click',
  dblclick: 'Double-click',
  hover: 'Hover',
  type: 'Type',
  fill: 'Fill',
  press: 'Key press',
  goto: 'Navigate',
  open: 'Open page',
  navigate: 'Navigate',
  scroll: 'Scroll',
  wait: 'Wait',
} as const;

const NAMES: Readonly<Record<string, string | undefined>> = STEP_KIND_NAMES;

/** A step kind's name ("Click", "Wait"), or the kind itself for one this app has no name for. */
export function stepKindName(kind: string) {
  return NAMES[kind] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Step');
}
