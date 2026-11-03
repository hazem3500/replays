import { buildNetworkRows, buildPerformance, collectErrors } from '@hazem3500/replays/viewer/diagnostics';
import { formatClock } from '@hazem3500/replays/model';
import { createReplayPlayback } from '@hazem3500/replays/viewer/playback';
// oxlint-disable-next-line import/no-unassigned-import -- why: this framework-free host explicitly opts into renderer styles.
import '@hazem3500/replays/viewer/playback/style.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: this example supplies its own page styles.
import './style.css';

import { readRecording } from './load.ts';

function element<T extends HTMLElement>(selector: string) {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

const playback = createReplayPlayback();
const file = element<HTMLInputElement>('#recording');
const stage = element<HTMLDivElement>('#stage');
const frame = element<HTMLDivElement>('#frame');
const play = element<HTMLButtonElement>('#play');
const seek = element<HTMLInputElement>('#seek');
const time = element<HTMLOutputElement>('#time');
const error = element<HTMLParagraphElement>('#error');
const diagnostics = element<HTMLOutputElement>('#diagnostics');
let unmount: (() => void) | undefined;
let fitKey = '';
function fit() {
  const viewport = playback.getSnapshot().viewport;
  if (!viewport.width || !viewport.height) return;
  const key = `${stage.clientWidth}:${stage.clientHeight}:${viewport.width}:${viewport.height}`;
  if (key === fitKey) return;
  fitKey = key;
  const scale = Math.min(stage.clientWidth / viewport.width, stage.clientHeight / viewport.height);
  frame.style.width = `${viewport.width}px`;
  frame.style.height = `${viewport.height}px`;
  frame.style.transform = `translate(${(stage.clientWidth - viewport.width * scale) / 2}px, ${(stage.clientHeight - viewport.height * scale) / 2}px) scale(${scale})`;
}
const observer = new ResizeObserver(fit);
observer.observe(stage);

const unsubscribe = playback.subscribe(() => {
  fit();
  const snapshot = playback.getSnapshot();
  const ready = snapshot.phase === 'ready';
  play.disabled = !ready;
  seek.disabled = !ready;
  play.textContent = snapshot.state.status === 'playing' ? 'Pause' : 'Play';
  seek.max = String(snapshot.duration);
  seek.value = String(snapshot.time);
  time.value = `${formatClock(snapshot.time)} / ${formatClock(snapshot.duration)}`;
});
play.addEventListener('click', () => playback.actions.playPause());
seek.addEventListener('input', () => playback.actions.seek(seek.valueAsNumber));
async function loadFile() {
  const selected = file.files?.[0];
  if (!selected) return;
  try {
    const bundle = await readRecording(selected);
    playback.load(bundle);
    diagnostics.value = `${buildNetworkRows(bundle).length} requests, ${buildPerformance(bundle).moments.length} performance moments, ${collectErrors(bundle).length} errors`;
    stage.style.aspectRatio = `${bundle.meta.viewport.width} / ${bundle.meta.viewport.height}`;
    unmount ??= playback.mount(frame);
    fit();
    error.textContent = '';
  } catch (failure) {
    error.textContent = failure instanceof Error ? failure.message : 'Could not read the recording.';
  }
}
file.addEventListener('change', () => {
  void loadFile();
});
window.addEventListener(
  'pagehide',
  () => {
    observer.disconnect();
    unsubscribe();
    unmount?.();
    playback.destroy();
  },
  { once: true },
);

export { createReplayPlayback };
