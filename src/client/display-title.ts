import type { ReplaySourceLink } from '../shared/replay.ts';

const KINDS = ['Design review', 'Walkthrough', 'Triage', 'Review', 'Bug report', 'Demo'];
const REF = /^([^\s/#]+\/[^\s/#]+)#(\d+)$/;
const COMMIT_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s+/i;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "toggl/toggl_focus_fe#7893" -> "focus_fe#7893"; undefined unless the source is a GitHub PR or issue. */
export function sourceShortLabel(link: Pick<ReplaySourceLink, 'provider' | 'label'>) {
  const match = link.provider === 'github' ? REF.exec(link.label) : null;
  return match ? `${match[1]!.split('/')[1]!.replace(/^toggl_/, '')}#${match[2]}` : undefined;
}

/** A row's title without the kind and `owner/repo#N` its chips and source link already say, and without a commit prefix. */
export function displayTitle(meta: { title: string; sources?: Pick<ReplaySourceLink, 'label'>[] | undefined }) {
  const parts = meta.title.split(' · ');
  const [kind, ref, ...rest] = parts;
  if (!kind || !ref || !rest.length || !KINDS.includes(kind) || !meta.sources?.some((source) => source.label === ref)) return meta.title;
  const text = rest.join(' · ').replace(COMMIT_PREFIX, '');
  return text ? capitalize(text) : meta.title;
}
