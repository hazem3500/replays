// @vitest-environment jsdom
// why: happy-dom 21.0.4 lacks window.DOMTokenList and serializes unmasked text empty, so the unmask assertions cannot run there.
import { describe, expect, it } from 'vitest';
import { createRecorder } from './recorder.ts';
import type { IssueReport } from './upload.ts';

/**
 * Runs the real rrweb 2.1.7 recorder to check what the masking options
 * actually produce in the full snapshot.
 */
describe('with the real rrweb recorder', () => {
  it('masks text and inputs and blocks media and the recorder UI', async () => {
    document.body.innerHTML = `
      <h1>Jane's workspace</h1>
      <nav data-public><a href="/projects">Projects</a></nav>
      <input type="text" value="secret input" />
      <input type="password" value="hunter2" />
      <img src="https://cdn.example.com/avatar.png?signature=abc" alt="Jane" />
      <div data-recorder-ui>Recorder UI</div>
    `;
    let report: IssueReport | undefined;
    const recorder = createRecorder({
      upload: (value) => {
        report = value;
        return Promise.resolve({ replayId: 'issue-1' });
      },
      ui: {
        requestConsent: () => Promise.resolve(true),
        showIndicator: () => () => undefined,
        confirmUpload: () => Promise.resolve({ confirmed: true } as const),
      },
      privacy: { unmaskTextSelector: '[data-public]' },
    });
    await recorder.start({ consent: true });
    recorder.stop();
    await recorder.upload({ confirmed: true });

    if (!report) throw new Error('nothing was uploaded');
    const serialized = JSON.stringify(report.bundle.events);
    expect(report.bundle.events.some((event) => event.type === 2)).toBe(true);
    expect(serialized).not.toContain('Jane');
    expect(serialized).not.toContain('secret input');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('avatar.png');
    expect(serialized).not.toContain('Recorder UI');
    expect(serialized).toContain('Projects');
  });

  it('masks text-bearing attributes, in the snapshot and in mutations', async () => {
    document.body.innerHTML = `
      <span id="entry" class="entry" title="Invoice for Acme" data-state="open"
        data-customer="Acme Corp">Invoice</span>
      <button aria-label="Remove Jane Doe" aria-expanded="false">x</button>
      <input type="text" placeholder="Jane's notes" />
      <input type="submit" value="Bill Acme" />
      <a href="mailto:jane@example.com">mail</a>
      <svg viewBox="0 0 10 10"><path d="M0 0L10 10" aria-label="Jane chart" /></svg>
      <nav data-public><a title="All projects" href="/projects">Projects</a></nav>
    `;
    let report: IssueReport | undefined;
    const recorder = createRecorder({
      upload: (value) => {
        report = value;
        return Promise.resolve({ replayId: 'issue-1' });
      },
      ui: {
        requestConsent: () => Promise.resolve(true),
        showIndicator: () => () => undefined,
        confirmUpload: () => Promise.resolve({ confirmed: true } as const),
      },
      privacy: { unmaskTextSelector: '[data-public]' },
    });
    await recorder.start({ consent: true });
    const entry = document.getElementById('entry');
    entry?.setAttribute('title', 'Renamed to Globex');
    entry?.setAttribute('data-state', 'closed');
    const added = document.createElement('div');
    added.setAttribute('aria-label', 'Hello Jane');
    added.dataset.note = 'Globex secret';
    document.body.append(added);
    await new Promise((resolve) => setTimeout(resolve, 0));
    recorder.stop();
    await recorder.upload({ confirmed: true });

    if (!report) throw new Error('nothing was uploaded');
    const serialized = JSON.stringify(report.bundle.events);
    for (const secret of ['Acme', 'Jane', 'Globex', 'jane@example.com']) expect(serialized).not.toContain(secret);
    // why: what the replay needs to render stays readable.
    expect(serialized).toContain('"class":"entry"');
    expect(serialized).toContain('"data-state":"open"');
    expect(serialized).toContain('"data-state":"closed"');
    expect(serialized).toContain('"aria-expanded":"false"');
    expect(serialized).toContain('"d":"M0 0L10 10"');
    // why: unmasked chrome keeps its attributes.
    expect(serialized).toContain('All projects');
  });

  it('redacts CSS URLs from real rrweb snapshots and stylesheet mutations', async () => {
    document.head.innerHTML = `<style id="captured-style">@import "https://cdn.example.test/site.css?api_key=import-secret"; .hero { background-image: url("https://user:pass@cdn.example.test/a.png?token=css-secret&theme=dark") }</style>`;
    document.body.innerHTML = `<div id="styled" style="background-image: url(https://inline:password@cdn.example.test/i.png?signature=inline-secret); color: red"></div>`;
    let report: IssueReport | undefined;
    const recorder = createRecorder({
      upload: (value) => {
        report = value;
        return Promise.resolve({ replayId: 'css' });
      },
      ui: { requestConsent: async () => true, showIndicator: () => () => undefined, confirmUpload: async () => ({ confirmed: true }) },
    });
    await recorder.start({ consent: true });
    const dynamic = document.createElement('style');
    document.head.append(dynamic);
    dynamic.sheet?.insertRule('.dynamic { background: url(https://user:pass@cdn.example.test/m.png?token=mutation-secret) }');
    await new Promise((resolve) => setTimeout(resolve, 0));
    dynamic.textContent = '.changed { background: url("https://user:pass@cdn.example.test/t.png?token=text-mutation-secret"/*comment*/) }';
    await new Promise((resolve) => setTimeout(resolve, 0));
    recorder.stop();
    await recorder.upload({ confirmed: true });

    if (!report) throw new Error('nothing was uploaded');
    const serialized = JSON.stringify(report.bundle.events);
    for (const secret of [
      'user:pass',
      'inline:password',
      'css-secret',
      'import-secret',
      'inline-secret',
      'mutation-secret',
      'text-mutation-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('theme=dark');
    expect(serialized).toContain('color: red');
    expect(serialized).toContain('site.css');
  });
  it('preserves ordinary text/input content on opt-out while protecting credential fields and URLs', async () => {
    document.body.innerHTML = `<h1>Useful project title</h1><input type="text" value="ordinary input" /><input type="password" value="password secret" /><input type="hidden" value="hidden credential" /><a href="https://name:password@example.com/path?token=private-token">Open project</a>`;
    let report: IssueReport | undefined;
    const recorder = createRecorder({
      privacy: { sanitize: false },
      upload: (value) => {
        report = value;
        return Promise.resolve({ replayId: 'issue-1' });
      },
      ui: { requestConsent: async () => true, showIndicator: () => () => {}, confirmUpload: async () => ({ confirmed: true }) },
    });
    await recorder.start({ consent: true });
    recorder.stop();
    await recorder.upload({ confirmed: true });
    if (!report) throw new Error('nothing was uploaded');
    const json = JSON.stringify(report.bundle.events);
    expect(json).toContain('Useful project title');
    expect(json).toContain('ordinary input');
    expect(json).not.toContain('password secret');
    expect(json).not.toContain('hidden credential');
    expect(json).not.toContain('name:password');
    expect(json).not.toContain('private-token');
    recorder.destroy();
  });
});
