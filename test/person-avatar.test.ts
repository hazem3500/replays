import { describe, expect, it } from 'vitest';

import { personAvatarSrc } from '../src/client/index/People.tsx';

describe('personAvatarSrc', () => {
  it('prefers the deployment avatar', () => {
    expect(personAvatarSrc({ role: 'reviewer', avatarUrl: 'https://img.example/a.png', handles: { github: 'octocat' } })).toBe(
      'https://img.example/a.png',
    );
  });

  it('falls back to the GitHub avatar of a github handle', () => {
    expect(personAvatarSrc({ role: 'pr-author', handles: { github: 'TobiasPrt' } })).toBe('https://github.com/TobiasPrt.png?size=48');
  });

  it('ignores an http avatar and a malformed handle', () => {
    expect(personAvatarSrc({ role: 'reviewer', avatarUrl: 'http://img.example/a.png' })).toBeUndefined();
    expect(personAvatarSrc({ role: 'reviewer', handles: { github: '../evil?x=1' } })).toBeUndefined();
  });

  it('has none without a github handle', () => {
    expect(personAvatarSrc({ role: 'reviewer', email: 'ada@example.com' })).toBeUndefined();
  });
});
