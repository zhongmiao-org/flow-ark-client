import { mkdirSync, writeFileSync } from 'node:fs';
import {
  api,
  optionalApi,
  fail,
  run,
  git,
  releaseVersion,
  output,
  versionParts,
} from './common.mjs';
const version = process.env.VERSION;
versionParts(version);
const repo = process.env.GITHUB_REPOSITORY;
const branch = `build/release-v${version}`;
releaseVersion(branch);
git('fetch', 'origin', 'main', '--tags');
const base = git('rev-parse', 'origin/main');
const remote = git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
if (remote) {
  git('fetch', 'origin', `refs/heads/${branch}`);
  const changes = git('diff', '--name-only', `${base}...${remote}`).split('\n').filter(Boolean);
  if (changes.some((file) => !['package.json', 'CHANGELOG.md', 'CHANGELOG_en.md'].includes(file)))
    fail('Existing release branch contains unrelated changes; refusing to overwrite it.');
  const authors = git('log', '--format=%ae', `${base}..${remote}`).split('\n');
  if (authors.some((author) => author !== '41898282+github-actions[bot]@users.noreply.github.com'))
    fail('Existing release branch has manual commits; refusing to overwrite it.');
}
git('switch', '-C', branch, base);
run(process.execPath, ['scripts/release/changelog.mjs', 'prepare'], { stdio: 'inherit' });
git('config', 'user.name', 'github-actions[bot]');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
git('add', 'package.json', 'CHANGELOG.md', 'CHANGELOG_en.md');
git('commit', '--signoff', '-m', `build(release): 准备发布 v${version}`);
git(
  'push',
  `--force-with-lease=refs/heads/${branch}:${remote || ''}`,
  '--set-upstream',
  'origin',
  `HEAD:refs/heads/${branch}`,
);
for (const [name, color, description] of [
  ['release', '0366d6', 'Release preparation'],
  ['automerge', '0e8a16', 'Merge after current checks pass'],
]) {
  if (!optionalApi(`repos/${repo}/labels/${name}`))
    api(
      `repos/${repo}/labels`,
      '-f',
      `name=${name}`,
      '-f',
      `color=${color}`,
      '-f',
      `description=${description}`,
    );
}
mkdirSync('.release', { recursive: true });
writeFileSync(
  '.release/pr-body.md',
  `准备发布 v${version}。\n\n将两份 Unreleased 归档并固定应用版本。CI 必须完成双语看门狗、类型/构建和四平台候选包后才能自动合并；合并后从准确提交重新打包并公开 Release。\n\n当前为开发预览；签名、公证及目标系统功能验收另记。\n`,
);
const prs = api(`repos/${repo}/pulls?state=open&base=main&head=${repo.split('/')[0]}:${branch}`);
let number;
if (prs.length) {
  number = prs[0].number;
  run('gh', [
    'pr',
    'edit',
    String(number),
    '--repo',
    repo,
    '--title',
    `build(release): 准备发布 v${version}`,
    '--body-file',
    '.release/pr-body.md',
    '--add-label',
    'release,automerge',
  ]);
} else {
  const url = run('gh', [
    'pr',
    'create',
    '--repo',
    repo,
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    `build(release): 准备发布 v${version}`,
    '--body-file',
    '.release/pr-body.md',
    '--label',
    'release',
    '--label',
    'automerge',
  ]);
  number = Number(url.split('/').pop());
}
const sha = git('rev-parse', 'HEAD');
// Dispatch avoids silent suppression of bot push/labeled events; approval-required PR runs still block merge.
run('gh', [
  'workflow',
  'run',
  'ci.yml',
  '--repo',
  repo,
  '--ref',
  branch,
  '-f',
  `pr_number=${number}`,
  '-f',
  `expected_head=${sha}`,
]);
output({ pr_number: number, sha, version });
console.log(
  `Prepared https://github.com/${repo}/pull/${number} at ${sha}. Candidate CI dispatched.`,
);
