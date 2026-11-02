import { ISSUES_TAB } from './inspector-tabs.tsx';

/**
 * The panel a replay opens on until the person picks one: Issues when it has any; otherwise Steps where steps live in a
 * tab (phones), else Issues and its "no problems" state. Pure and light: the eager page shell calls it.
 */
export function defaultInspectorPanel({ mobile, steps = 0, issues = false }: { mobile: boolean; steps?: number | undefined; issues?: boolean }) {
  if (ISSUES_TAB && issues) return 'issues';
  if (mobile && steps > 0) return 'steps';
  return ISSUES_TAB ? 'issues' : 'console';
}
