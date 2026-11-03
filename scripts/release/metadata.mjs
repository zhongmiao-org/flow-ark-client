import { mkdirSync, writeFileSync } from 'node:fs';
import {
  api,
  findRelease,
  fail,
  run,
  git,
  assertSha,
  releaseVersion,
  validateRelease,
  allArtifactNames,
  output,
} from './common.mjs';
const repo = process.env.GITHUB_REPOSITORY;
const number = process.env.PR_NUMBER;
if (!/^\d+$/.test(number)) fail('pr_number must identify a merged release PR.');
const pr = api(`repos/${repo}/pulls/${number}`);
if (
  !pr.merged ||
  pr.base.ref !== 'main' ||
  pr.head.repo?.full_name !== repo ||
  !pr.labels.some((l) => l.name === 'release')
)
  fail('Only a merged same-repository release PR targeting main may publish.');
const version = releaseVersion(pr.head.ref);
const sha = assertSha(pr.merge_commit_sha);
git('fetch', 'origin', 'main', '--tags');
git('checkout', '--detach', sha);
git('merge-base', '--is-ancestor', sha, 'origin/main');
const logs = validateRelease(version);
const tag = `v${version}`;
if (git('tag', '--list', tag)) {
  if (git('rev-parse', `${tag}^{commit}`) !== sha)
    fail(`${tag} points to a different commit; tags are immutable.`);
} else {
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('tag', '-a', tag, sha, '-m', `Release ${tag}`);
  git('push', 'origin', `refs/tags/${tag}`);
}
mkdirSync('.release', { recursive: true });
const notes = `${logs[1][1].body}\n\n---\n\n${logs[0][1].body}\n`;
writeFileSync('.release/notes.md', notes);
const existing = findRelease(repo, tag);
const artifactRun = process.env.ARTIFACT_RUN_ID || '';
if (artifactRun && !existing?.draft && !existing)
  fail('Artifact recovery requires an existing release.');
if (artifactRun && existing?.draft) {
  if (!/^[1-9]\d*$/.test(artifactRun)) fail('Invalid artifact_run_id.');
  const previous = api(`repos/${repo}/actions/runs/${artifactRun}`);
  if (
    previous.path !== '.github/workflows/release.yml' ||
    previous.head_repository.full_name !== repo
  )
    fail('Recovery artifacts must come from this repository Release workflow.');
  const jobs = JSON.parse(
    run('gh', [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repo}/actions/runs/${artifactRun}/jobs?per_page=100`,
    ]),
  ).flatMap((page) => page.jobs);
  for (const platform of ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']) {
    if (
      !jobs.some(
        (job) =>
          job.name === `Release Packages / Package (${platform})` && job.conclusion === 'success',
      )
    )
      fail(`Recovery requires a successful native package job: ${platform}`);
  }
  const artifacts = api(
    `repos/${repo}/actions/runs/${artifactRun}/artifacts?per_page=100`,
  ).artifacts;
  for (const platform of ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']) {
    if (
      !artifacts.some(
        (artifact) => artifact.name === `release-${sha}-${platform}` && !artifact.expired,
      )
    )
      fail(`Recovery artifact missing or source SHA mismatch: ${platform}`);
  }
}
output({ artifact_run_id: artifactRun });
if (existing && !existing.draft) {
  const names = existing.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(allArtifactNames(version).sort()))
    fail('Published release has incomplete or unexpected assets; refusing to overwrite it.');
  for (const asset of existing.assets)
    if (!asset.size || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ''))
      fail(`Published asset lacks a SHA-256 digest: ${asset.name}`);
  if (existing.body.trim() !== notes.trim())
    fail('Published release notes differ from its immutable changelog.');
  run('gh', [
    'release',
    'download',
    tag,
    '--repo',
    repo,
    '--pattern',
    '*-SHA256SUMS.txt',
    '--dir',
    '.release',
    '--clobber',
  ]);
  const { readFileSync } = await import('node:fs');
  for (const manifest of allArtifactNames(version).filter((name) =>
    name.endsWith('-SHA256SUMS.txt'),
  )) {
    const lines = readFileSync(`.release/${manifest}`, 'utf8').trim().split('\n');
    if (lines.length !== 2) fail(`Invalid published checksum file: ${manifest}`);
    for (const line of lines) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (
        !match ||
        existing.assets.find((asset) => asset.name === match[2])?.digest !== `sha256:${match[1]}`
      )
        fail(`Published checksum mismatch: ${manifest}`);
    }
  }
  output({ version, sha, tag, published: 'true' });
  console.log(
    `${tag} is already published; tag, notes, assets and digests verified without modification.`,
  );
} else {
  run(
    'gh',
    existing
      ? [
          'release',
          'edit',
          tag,
          '--repo',
          repo,
          '--title',
          tag,
          '--notes-file',
          '.release/notes.md',
          '--draft=true',
          '--latest=false',
        ]
      : [
          'release',
          'create',
          tag,
          '--repo',
          repo,
          '--verify-tag',
          '--draft',
          '--title',
          tag,
          '--notes-file',
          '.release/notes.md',
          '--latest=false',
        ],
  );
  output({ version, sha, tag, published: 'false' });
}
