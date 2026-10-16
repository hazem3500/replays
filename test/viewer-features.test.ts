import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import {
  activeFeatures,
  FeatureProviders,
  FeatureScrubberOverlays,
  registerViewerFeature,
  resetViewerFeatures,
  useFeatureBadges,
} from '../src/client/plugins/features.tsx';
import { CommentsBridge } from '../src/client/comments/CommentsProvider.tsx';
import { registerCommentsFeature } from '../src/client/comments/feature.tsx';
import { setCommentsEnabledForTests } from '../src/client/comments/enabled.ts';

afterEach(() => {
  resetViewerFeatures();
  setCommentsEnabledForTests(undefined);
});

const tag =
  (name: string) =>
  ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-provider': name }, children);

describe('built-in viewer features', () => {
  it('lists only the features that are enabled, and refuses a duplicate id', () => {
    registerViewerFeature({ id: 'on', enabled: () => true });
    registerViewerFeature({ id: 'off', enabled: () => false });
    expect(activeFeatures().map((feature) => feature.id)).toEqual(['on']);
    expect(() => registerViewerFeature({ id: 'on', enabled: () => true })).toThrow('viewer feature on is registered twice');
  });

  it('wraps the viewer in every active provider, first registered outermost, and passes the props', () => {
    const seen: string[] = [];
    registerViewerFeature({
      id: 'a',
      enabled: () => true,
      Provider: ({ children, replayId }) => (seen.push(replayId), createElement('i', { 'data-a': '' }, children)),
    });
    registerViewerFeature({ id: 'b', enabled: () => true, Provider: tag('b') as never });
    registerViewerFeature({ id: 'c', enabled: () => false, Provider: tag('c') as never });
    const html = renderToStaticMarkup(
      FeatureProviders({
        replayId: 'r1',
        timeline: undefined,
        openPanel: () => {},
        registerStartAction: () => {},
        children: createElement('main'),
      }),
    );
    expect(html).toBe('<i data-a=""><div data-provider="b"><main></main></div></i>');
    expect(seen).toEqual(['r1']);
  });

  it('draws the scrubber overlays of active features, and nothing when there are none', () => {
    expect(renderToStaticMarkup(createElement(FeatureScrubberOverlays, { width: 100, inset: 4 }))).toBe('');
    registerViewerFeature({
      id: 'marks',
      enabled: () => true,
      ScrubberOverlay: ({ width, inset }) => createElement('b', null, `${width}/${inset}`),
    });
    expect(renderToStaticMarkup(createElement(FeatureScrubberOverlays, { width: 100, inset: 4 }))).toBe('<b>100/4</b>');
  });

  it('collects tab badges by feature id', () => {
    registerViewerFeature({
      id: 'x',
      enabled: () => true,
      tab: { label: 'X', Icon: (() => null) as never, Panel: () => null, useBadge: () => 3 },
    });
    registerViewerFeature({ id: 'y', enabled: () => true, tab: { label: 'Y', Icon: (() => null) as never, Panel: () => null } });
    expect(useFeatureBadges()).toEqual({ x: 3, y: undefined });
  });

  it('comments register as a feature with a tab, a provider and seek-bar markers, active only when the page enables them', () => {
    registerCommentsFeature();
    setCommentsEnabledForTests(false);
    expect(activeFeatures()).toEqual([]);
    setCommentsEnabledForTests(true);
    const [comments] = activeFeatures();
    expect(comments?.id).toBe('comments');
    expect(comments?.tab).toMatchObject({ label: 'Comments', shortcut: 'add-comment' });
    expect(comments?.Provider).toBeTypeOf('function');
    expect(comments?.ScrubberOverlay).toBeDefined();
    expect(CommentsBridge).toBeTypeOf('function');
  });
});
