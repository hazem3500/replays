import type { Terminal } from '../capture/terminal.ts';
import { bundleSpan, editListOf, normalizeEdits, type ReplayEdits } from '../shared/edits.ts';
import type { ParsedArgs } from './args.ts';
import { listEdits } from './describe.ts';
import { EditError, usageError } from './errors.ts';
import { type InspectedMoment, type Inspection, inspectReplay } from './inspect.ts';
import { type EditOutput, only, positionals, type Session } from './session.ts';
import { formatTime, parseTime } from './time.ts';

const ms = (value: number) => `${Math.round(value)}ms`;
const seconds = (value: number) => `${(value / 1000).toFixed(3)}s`;

const counts = (record: Record<string, number>) =>
  Object.entries(record)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');

/** Edits when the server has the editor on; an editor-less server still lets the replay itself be inspected. */
async function readEdits(session: Session): Promise<ReplayEdits | undefined> {
  try {
    return normalizeEdits(editListOf((await session.client.getEdits()).edits));
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

function momentLines(term: Terminal, moment: InspectedMoment) {
  const { applied } = moment;
  const doc = moment.document < 0 ? 'no document yet' : `document ${moment.document + 1}${moment.href ? ` (${moment.href})` : ''}`;
  const mutations = applied.mutations;
  return [
    `  ${term.bold(`at ${seconds(moment.time)}`)}  renders offset ${ms(moment.renderOffset)}, ${doc}`,
    `    rebuild from Meta at ${moment.rebuildFrom === undefined ? 'none' : ms(moment.rebuildFrom)}, then ${applied.events} events: ${counts(applied.byKind) || 'none'}`,
    `    mutations: ${mutations.adds} adds, ${mutations.removes} removes, ${mutations.attributes} attributes, ${mutations.texts} texts; ${moment.missingNodes} name a missing node`,
    `    they land in: page ${applied.byPlace.page}, shadow roots ${applied.byPlace.shadow}, frames ${applied.byPlace.frame}`,
    ...moment.mostChanged.map(
      (node) =>
        `      #${node.id} <${node.tag}> ${node.place} ×${node.changes}${node.attributes.length ? `  ${node.attributes.join(' ')}` : ''}`,
    ),
    `    previous event ${moment.previousEvent ? `${ms(moment.previousEvent.at)} ${moment.previousEvent.kind}` : 'none'}, next ${moment.nextEvent ? `${ms(moment.nextEvent.at)} ${moment.nextEvent.kind}` : 'none'}`,
  ];
}

function text(term: Terminal, session: Session, title: string, inspection: Inspection, edits: ReplayEdits | undefined) {
  const { viewport } = inspection;
  return [
    `${term.bold(title)}  ${term.dim(`${session.client.id} · ${formatTime(inspection.duration)} · ${inspection.source}`)}`,
    term.link(session.client.link),
    '',
    `  duration     ${ms(inspection.duration)} of events (meta says ${ms(inspection.recordedDuration)})`,
    `  viewport     ${viewport.width}x${viewport.height}${inspection.resizes.length > 1 ? `, resized ${inspection.resizes.length - 1} times` : ''}`,
    `  first paint  ${ms(inspection.firstPaint)} (the frame a paused seek to 0 shows)`,
    `  events       ${inspection.events.total}: ${counts(inspection.events.byKind)}`,
    `  meta events  ${inspection.metas.map(ms).join(', ') || 'none'}`,
    `  media        ${
      inspection.media
        .map((item) => `${ms(item.at)} #${item.id} <${item.tag}>${item.playable ? '' : ' (not a media element; the player drops it)'}`)
        .join(', ') || 'none'
    }`,
    '',
    term.bold('Documents'),
    ...inspection.documents.map(
      (doc) =>
        `  ${doc.index + 1}  from ${ms(doc.start)}  snapshot ${ms(doc.snapshot)}${doc.ready === undefined ? '' : `  styles ready ${ms(doc.ready)}`}  ${doc.dom.nodes} nodes, ${doc.dom.shadowRoots} shadow roots, ${doc.dom.iframes} iframes, ${doc.dom.canvases} canvases, ${doc.dom.customElements} custom elements${doc.href ? `  ${doc.href}` : ''}`,
    ),
    ...(inspection.moments.length
      ? ['', term.bold('Paused frames'), ...inspection.moments.flatMap((moment) => momentLines(term, moment))]
      : []),
    '',
    term.bold('Edits'),
    ...(edits ? listEdits(edits) : ['not available: the server has the editor turned off']).map((line) => `  ${line}`),
  ].join('\n');
}

/** `inspect [--at 1s,5.2s]`: the replay's playback shape, read from the server without saving anything. */
export async function inspect(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['at'], 'inspect');
  positionals(args, { min: 0, max: 0 }, 'inspect [--at 1s,5.2s]');
  const [bundle, edits] = await Promise.all([session.bundle(), readEdits(session)]);
  const end = bundleSpan(bundle);
  const at = args.values.at;
  const times = at === undefined ? [] : at.split(',').map((item) => parseTime(item, end));
  if (times.some((time) => time > end)) throw usageError(`--at must be within the replay (0 to ${formatTime(end)})`);
  const inspection = inspectReplay(bundle, times);
  const { client } = session;
  return {
    json: { success: true, id: client.id, link: client.link, title: bundle.meta.title, ...inspection, ...(edits ? { edits } : {}) },
    text: (term) => text(term, session, bundle.meta.title, inspection, edits),
  };
}
