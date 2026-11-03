import { readFileSync } from 'node:fs';
import { api, fail, assertSha, releaseVersion, output } from './common.mjs';
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const number = event.pull_request?.number ?? event.inputs?.pr_number;
if (!number) {
  output({
    sha: assertSha(process.env.GITHUB_SHA),
    pr_number: '',
    base_sha: '',
    branch: '',
    title: '',
    labels: '[]',
    author: '',
    is_release: 'false',
    version: '',
  });
} else {
  if (!/^\d+$/.test(String(number))) fail('Invalid PR number.');
  const pr = api(`repos/${process.env.GITHUB_REPOSITORY}/pulls/${number}`);
  if (pr.state !== 'open' || pr.base.ref !== 'main') fail('PR must be open and target main.');
  if (event.inputs?.expected_head && pr.head.sha !== event.inputs.expected_head)
    fail('PR changed since dispatch; rerun prepare-release for its latest head.');
  if (event.pull_request && pr.head.sha !== event.pull_request.head.sha)
    fail('Stale PR event; wait for latest checks.');
  const branch = pr.head.ref;
  const title = pr.title;
  if (
    !branch.startsWith('build/release-v') &&
    !/^(feat|fix|docs|chore|refactor|perf|test|style|build|revert|ci)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(
      branch,
    )
  )
    fail('Branch must follow type/short-description.');
  if (
    !/^(feat|fix|docs|chore|refactor|perf|test|style|build|revert|ci)(\([a-z0-9-]+\))?!?: .+/.test(
      title,
    ) ||
    /[\r\n]/.test(title)
  )
    fail('PR title must follow Conventional Commits.');
  const labels = pr.labels.map((l) => l.name);
  const isRelease = branch.startsWith('build/release-v') || labels.includes('release');
  const version = isRelease ? releaseVersion(branch) : '';
  output({
    sha: assertSha(pr.head.sha),
    pr_number: String(number),
    base_sha: assertSha(pr.base.sha),
    branch,
    title,
    labels: JSON.stringify(labels),
    author: pr.user.login,
    is_release: String(isRelease),
    version,
    can_merge: String(
      pr.head.repo?.full_name === process.env.GITHUB_REPOSITORY &&
        !pr.draft &&
        labels.includes('automerge'),
    ),
  });
}
