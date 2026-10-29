import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/**
 * A few fictional review comments for demo replays, so the Comments tab and the seek-bar markers have a populated
 * state to look at. Each replay that has no comments yet gets `<data-dir>/<id>/comments.json` (the comment store's
 * format, src/server/comments-store.ts); a replay that already has comments is left alone.
 *
 *   node scripts/demo-comments.mjs --data-dir .data/replays --sample-dir demo-seed-output/sample demo-seed-signup
 */

const PEOPLE = {
  mira: { id: 'demo:mira', name: 'Mira Chen' },
  theo: { id: 'demo:theo', name: 'Theo Park' },
  sam: { id: 'demo:sam', name: 'Sam Okafor' },
};

/** [who, fraction of the replay (or null for the whole replay), text or emoji, minutes ago, replies, resolved by]. */
const SCRIPT = [
  [
    'mira',
    null,
    'Walked through this before standup. Two layout notes and one copy question below.',
    190,
    [['theo', 'Thanks, I will pick up the layout ones today.', 170]],
  ],
  [
    'theo',
    0.18,
    'The submit button shifts down when the error message appears. Can we reserve the space?',
    160,
    [
      ['mira', 'Agreed, it jumps about 8 px on my screen.', 150],
      ['sam', 'Fixed in the next build, I will record it again.', 95],
    ],
  ],
  ['sam', 0.22, '👀', 140],
  ['mira', 0.25, '🐛', 120],
  ['sam', 0.45, 'Is this loading state long enough to need a skeleton?', 80],
  ['mira', 0.62, 'Copy: "Your order is placed" reads better than "Order placed successfully".', 60, [], 'theo'],
  ['theo', 0.8, '🎉', 30],
  ['theo', 0.86, 'Nice, the confirmation lands in under a second here.', 25],
];

const EMOJI = new Set(['👍', '🎉', '👀', '🤔', '🐛']);

/** The comments file for one replay `duration` ms long, written `now`. Ids are stable per replay `index`. */
export function demoComments(duration, now = Date.now(), index = 0) {
  const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const comments = [];
  let serial = 0;
  const id = () => `c-demo${String(index).padStart(2, '0')}${String((serial += 1)).padStart(3, '0')}`;
  for (const [who, fraction, text, minutes, replies = [], resolvedBy] of SCRIPT) {
    const rootId = id();
    const emoji = EMOJI.has(text);
    comments.push({
      id: rootId,
      ...(fraction === null ? {} : { at: Math.round(duration * fraction) }),
      body: emoji ? '' : text,
      ...(emoji ? { emoji: text } : {}),
      author: PEOPLE[who],
      createdAt: ago(minutes),
      ...(resolvedBy ? { resolved: { by: PEOPLE[resolvedBy].name, at: ago(minutes - 10) } } : {}),
    });
    for (const [replier, body, replyMinutes] of replies)
      comments.push({ id: id(), parentId: rootId, body, author: PEOPLE[replier], createdAt: ago(replyMinutes) });
  }
  return { version: 1, comments };
}

async function replayDuration(id, sampleDir, dataDir) {
  for (const path of [sampleDir && join(sampleDir, `${id}.json`), join(dataDir, id, 'replay.json')].filter(Boolean)) {
    try {
      return JSON.parse(await readFile(path, 'utf8')).meta.duration;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`no replay ${id} in ${sampleDir ?? '(no sample dir)'} or ${dataDir}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'data-dir': { type: 'string' }, 'sample-dir': { type: 'string' } },
  });
  const dataDir = values['data-dir'];
  if (!dataDir || positionals.length === 0) throw new Error('usage: demo-comments.mjs --data-dir DIR [--sample-dir DIR] REPLAY_ID...');
  for (const [index, id] of positionals.entries()) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error(`not a replay id: ${id}`);
    const file = demoComments(await replayDuration(id, values['sample-dir'], dataDir), Date.now(), index);
    await mkdir(join(dataDir, id), { recursive: true });
    try {
      await writeFile(join(dataDir, id, 'comments.json'), `${JSON.stringify(file)}\n`, { flag: 'wx' });
      console.log(`Seeded ${file.comments.length} comments on ${id}`);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      console.log(`${id} already has comments; left alone`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
