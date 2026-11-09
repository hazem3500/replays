import type { ReplaySourceLink } from '../shared/replay.ts';

const KINDS = ['Design review', 'Walkthrough', 'Triage', 'Review', 'Bug report', 'Demo'];
const REF = /^[^\s/#]+\/([^\s/#]+)#(\d+)$/;
const COMMIT_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s+/i;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "toggl/toggl_focus_fe#7893" -> "focus_fe#7893"; undefined unless the source is a GitHub PR or issue. */
export function sourceShortLabel(link: Pick<ReplaySourceLink, 'provider' | 'label'>) {
  const match = link.provider === 'github' ? REF.exec(link.label) : null;
  return match ? `${match[1]?.replace(/^toggl_/, '')}#${match[2]}` : undefined;
}

/** The title's text after its kind and matching source reference, when it has both. */
function afterKindAndRef(title: string, labels: Set<string>) {
  const [kind = '', ref = '', ...rest] = title.split(' · ');
  return KINDS.includes(kind) && labels.has(ref) ? rest.join(' · ') : '';
}

/** A row's title without the kind and `owner/repo#N` its chips and source link already say, and without a commit prefix. */
export function displayTitle(meta: { title: string; sources?: Pick<ReplaySourceLink, 'label'>[] | undefined }) {
  const text = afterKindAndRef(meta.title, new Set(meta.sources?.map((source) => source.label))).replace(COMMIT_PREFIX, '');
  return text ? capitalize(text) : meta.title;
}

type ContextSource = { label?: string | undefined; ref?: string | undefined };

/** The tab title for a replay: its title with the kind and source reference its context already carries removed. */
export function contextTitle(bundle: { meta: { title: string }; context?: { sources?: ContextSource[] | undefined } | undefined }) {
  const sources = bundle.context?.sources?.map((source) => ({ label: source.label ?? source.ref ?? '' }));
  return displayTitle({ title: bundle.meta.title, sources });
}
