import { describe, expect, it } from 'vitest';

import { COMMANDS, commandHelp, renderAgentGuide, renderHelp } from '../src/command-help.ts';
import { checkChrome, checkFfmpeg, checkNode, checkServe, doctorOutcome, doctorRows } from '../src/capture/doctor.ts';
import { createTerminal } from '../src/capture/terminal.ts';

const plain = createTerminal({ env: {}, stream: { isTTY: false, write: () => true } });

describe('help and the agent guide share one set of command definitions', () => {
  it('lists every command in help and in the guide', () => {
    const help = renderHelp(plain);
    const guide = renderAgentGuide();
    for (const command of COMMANDS) {
      expect(help).toMatch(new RegExp(`^  ${command.name}\\s+`, 'm'));
      expect(help).toContain(command.summary);
      expect(guide).toContain(`### ${command.name}`);
      expect(guide).toContain(command.help ?? command.details ?? command.summary);
    }
  });

  it('limits the capture-only distribution to its own commands', () => {
    const help = renderHelp(plain, { captureOnly: true });
    expect(help).toContain('Capture-only distribution commands:');
    expect(help).not.toMatch(/^  serve\s/m);
    expect(renderAgentGuide({ captureOnly: true })).not.toContain('### serve');
  });

  it('prints the same usage for --help as the guide embeds', () => {
    expect(commandHelp('doctor', ['--help'])).toContain('--json');
    expect(commandHelp('status', ['--help'])).toContain('--json');
    expect(commandHelp('upload', ['-h'])).toContain('--json');
    expect(commandHelp('doctor', [])).toBeUndefined();
  });

  it('is plain, with no escape codes, when not at a terminal', () => {
    expect(renderHelp(plain)).not.toContain('\x1b');
    expect(renderAgentGuide()).not.toContain('\x1b');
  });

  it('dims descriptions and shows the brand header at a terminal', () => {
    const fancy = createTerminal({ env: { COLORTERM: 'truecolor' }, stream: { isTTY: true, write: () => true } });
    const help = renderHelp(fancy);
    expect(help).toContain('\x1b[2m');
    expect(help.startsWith(fancy.header())).toBe(true);
  });
});

describe('doctor checks', () => {
  it('judges the Node version', () => {
    expect(checkNode('24.22.1').status).toBe('ok');
    expect(checkNode('22.14.0')).toMatchObject({ status: 'ok', detail: '(Node 22.14.0)' });
    expect(checkNode('20.11.0').status).toBe('fail');
    expect(checkServe('22.22.0').status).toBe('ok');
    expect(checkServe('22.14.0')).toMatchObject({ status: 'warn', detail: 'needs Node 22.22+' });
  });

  it('splits capture and upload from serve so an old Node does not look like a broken CLI', () => {
    const out = createTerminal({ env: { NO_COLOR: '1' }, stream: { isTTY: true, write: () => true } });
    const rows = doctorRows([checkNode('22.16.0'), checkServe('22.16.0')], out);
    expect(rows).toEqual([
      ['capture/upload', '✓ (Node 22.16.0)'],
      ['serve', '✗ needs Node 22.22+'],
    ]);
    expect(doctorOutcome([checkNode('22.16.0'), checkServe('22.16.0')])).toBe('ok');
  });

  it('finds Chrome and ffmpeg from the environment, and warns rather than fails when missing', () => {
    expect(checkChrome({ CHROME_PATH: '/opt/chrome' }, () => true)).toMatchObject({ status: 'ok', detail: '/opt/chrome' });
    expect(checkFfmpeg({ FFMPEG_PATH: '/opt/ffmpeg' }, () => true)).toMatchObject({ status: 'ok', detail: '/opt/ffmpeg' });
    expect(checkChrome({ CHROME_PATH: '/gone' }, () => false).status).toBe('warn');
    expect(checkFfmpeg({ FFMPEG_PATH: '/gone' }, () => false).status).toBe('warn');
  });

  it('fails only when a check fails', () => {
    expect(
      doctorOutcome([
        { id: 'node', status: 'ok', detail: '' },
        { id: 'chrome', status: 'warn', detail: '' },
      ]),
    ).toBe('ok');
    expect(doctorOutcome([{ id: 'server', status: 'fail', detail: '' }])).toBe('fail');
  });
});
