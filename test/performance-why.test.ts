import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import { buildMoments, buildVitals } from '../src/client/viewer/performance/model.ts';
import { buildLanes } from '../src/client/viewer/performance/timeline-model.ts';
import {
  describeTarget,
  forcedLayoutTotal,
  interactionSentence,
  scriptFileName,
  scriptFunction,
  scriptTitle,
  styleLayoutShare,
} from '../src/client/viewer/performance/why.ts';
import { must } from './must.ts';
import { performanceFixture, whyTrack } from './performance-fixture.ts';

function recording() {
  const bundle = performanceFixture();
  bundle.performance = whyTrack();
  return bundle;
}

const momentsOf = (bundle = recording()) => {
  const model = buildPerformance(bundle);
  return { model, moments: buildMoments(model.signals, model.why) };
};

describe('performance why: moments', () => {
  it('lists interactions from the Event Timing breakdown beside the long tasks and frames no task covers', () => {
    expect(momentsOf().moments.map((item) => `${item.label} ${item.value}`)).toEqual([
      'Long task 310',
      "Click · button 'Add to cart' 56",
      'Long task 90',
      "Key press · textbox 'Search' 120",
      'Long task 140',
      "Click · button 'Plan time' 608",
      'Long task 182',
      'Long frame 90',
    ]);
  });

  it('attaches a long animation frame to the long task it overlaps and to the interaction that points at it', () => {
    const { moments } = momentsOf();
    const task = must(moments.find((item) => item.label === 'Long task' && item.value === 182));
    expect(task.frame?.scripts.map((script) => script.sourceFunctionName)).toEqual(['buildSchedule', 'format']);
    const click = must(moments.find((item) => item.interaction?.interactionId === 3));
    expect(click.frame).toBe(task.frame);
    expect(click.verdict).toBe('poor');
    expect(must(moments.find((item) => item.value === 140)).frame).toBeUndefined();
  });

  it('keeps the older per-event interactions when the recording has no interaction track', () => {
    const bundle = recording();
    const track = must(bundle.performance);
    delete track.interactions;
    expect(momentsOf(bundle).moments.filter((item) => item.kind === 'interaction').map((item) => item.label)).toEqual(['Click', 'Key press', 'Click']);
  });

  it('does not count a frame no long task covers as a long task in the vitals', () => {
    const { model, moments } = momentsOf();
    const tbt = buildVitals(model.signals, moments, model.track).find((vital) => vital.id === 'tbt');
    expect(tbt?.value).toBe(260 + 40 + 90 + 132);
  });

  it('drops interactions inside a cut and moves the rest onto the edited clock', () => {
    const model = buildPerformance(recording(), editTimeline({ version: 1, cuts: [{ id: 'cut', from: 2000, to: 3000 }] }, 12_000));
    expect(model.why.interactions?.map((item) => item.at)).toEqual([4200, 7600]);
    expect(model.why.frames.map((frame) => frame.index)).toEqual([0, 1, 2]);
  });
});

describe('performance why: lanes', () => {
  it('draws the long tasks lane from animation frames where they exist, with the interaction breakdown in its tooltip data', () => {
    const { moments } = momentsOf();
    const lanes = buildLanes(moments, [], []);
    const tasks = must(lanes.find((lane) => lane.id === 'task'));
    expect(tasks.items.map((item) => item.title)).toEqual([
      'Long animation frame',
      'Long task',
      'Long task',
      'Long animation frame',
      'Long animation frame',
    ]);
    expect(tasks.items.find((item) => item.value === '640 ms')?.note).toBe('Blocked input for 560 ms');
    const slow = must(lanes.find((lane) => lane.id === 'interaction')).items.find((item) => item.value === '608 ms');
    expect(slow?.breakdown).toEqual({ inputDelay: 184, processing: 352, presentation: 72 });
  });
});

describe('performance why: wording', () => {
  it('describes the target and the action', () => {
    expect(describeTarget({ tag: 'button', role: 'button', name: 'Plan time' })).toBe("button 'Plan time'");
    expect(describeTarget({ tag: 'div' })).toBe('div');
    expect(describeTarget(undefined)).toBe('');
    const click = { at: 0, interactionId: 1, eventType: 'click', duration: 8, inputDelay: 0, processing: 0, presentation: 8 };
    expect(interactionSentence({ ...click, target: { tag: 'button', name: 'Plan time' } })).toBe("Clicked button 'Plan time'");
    expect(interactionSentence(click)).toBe('Clicked');
    expect(interactionSentence({ ...click, eventType: 'keydown', target: { tag: 'input' } })).toBe('Pressed a key on input');
  });

  it('names scripts by file and function, with the full address in the tooltip', () => {
    const [first] = must(whyTrack().longFrames)[0]?.scripts ?? [];
    const script = must(first);
    expect(scriptFileName(script.sourceURL)).toBe('plan-3f9a.js');
    expect(scriptFileName('https://example.com/')).toBe('example.com');
    expect(scriptFileName('')).toBe('inline script');
    expect(scriptFunction(script)).toBe('buildSchedule');
    expect(scriptFunction({ ...script, sourceFunctionName: '' })).toBe('BUTTON#plan.onclick');
    expect(scriptTitle(script)).toBe('https://app.example.com/assets/plan-3f9a.js\nfunction buildSchedule\nstarted by BUTTON#plan.onclick');
  });

  it('reads the style and layout share only when the browser reported where it started', () => {
    const [frame, boot] = must(whyTrack().longFrames);
    expect(styleLayoutShare(must(frame))).toEqual({ ms: 120, share: 120 / 640 });
    expect(styleLayoutShare(must(boot))).toBeUndefined();
    expect(forcedLayoutTotal(must(frame))).toBe(38);
  });
});
