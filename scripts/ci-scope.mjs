import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const docs = (file) => /^(?:[^/]+\.md|docs\/.*\.md)$/.test(file);
const story = (file) => /^(?:stories|\.storybook)\//.test(file);

export function selectChecks(files, event) {
  if (event !== 'pull_request' || files.length === 0) return { runtime: true, storybook: true };
  return {
    runtime: files.some((file) => !docs(file) && !story(file)),
    storybook: files.some((file) => !docs(file)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.CI_EVENT;
  const files =
    event === 'pull_request'
      ? execFileSync('git', ['diff', '--name-only', '-z', `${process.env.PR_BASE}...${process.env.PR_HEAD}`], {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        })
          .split('\0')
          .filter(Boolean)
      : [];
  const checks = selectChecks(files, event);
  console.log(JSON.stringify({ files: files.length, ...checks }));
  for (const [name, enabled] of Object.entries(checks)) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${enabled}\n`);
}
