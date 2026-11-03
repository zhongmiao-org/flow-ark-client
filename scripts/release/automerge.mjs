import { api, fail, run, assertSha } from './common.mjs';
const repo = process.env.GITHUB_REPOSITORY;
const number = process.env.PR_NUMBER;
if (!/^\d+$/.test(number)) fail('Invalid PR number.');
const head = assertSha(process.env.EXPECTED_HEAD);
const base = assertSha(process.env.EXPECTED_BASE);
const isRelease = process.env.IS_RELEASE === 'true';
function ready(pr) {
  return (
    pr.state === 'open' &&
    !pr.draft &&
    pr.base.ref === 'main' &&
    pr.base.sha === base &&
    pr.head.sha === head &&
    pr.head.repo?.full_name === repo &&
    pr.mergeable === true &&
    pr.labels.some((label) => label.name === 'automerge') &&
    (!isRelease || pr.labels.some((label) => label.name === 'release')) &&
    pr.title === process.env.EXPECTED_TITLE &&
    JSON.stringify(pr.labels.map((label) => label.name).sort()) ===
      JSON.stringify(JSON.parse(process.env.EXPECTED_LABELS).sort())
  );
}
const approvals = api(`repos/${repo}/actions/runs?head_sha=${head}&per_page=100`).workflow_runs;
if (approvals.some((workflow) => workflow.conclusion === 'action_required'))
  fail('GitHub requires approval for a workflow on this head; approve it before merging.');
let pr = api(`repos/${repo}/pulls/${number}`);
if (!ready(pr)) fail('PR head/base, labels or mergeability changed; fresh checks are required.');
for (let attempt = 0; attempt < 40; attempt++) {
  // gh pr checks resolves the PR's current head/merge checks; never reuse a previous commit's success.
  let text;
  try {
    text = run('gh', [
      'pr',
      'checks',
      number,
      '--repo',
      repo,
      '--json',
      'name,state,bucket,workflow,link',
    ]);
  } catch (error) {
    text = String(error.stdout || '');
    if (!text.trim().startsWith('[')) throw error;
  }
  const reported = JSON.parse(text).filter((check) => !/(^|\/ )Auto Merge$/.test(check.name));
  const runId = (check) => /\/actions\/runs\/(\d+)/.exec(check.link ?? '')?.[1];
  const runs = new Map();
  for (const id of new Set(reported.map(runId).filter(Boolean))) {
    const info = api(`repos/${repo}/actions/runs/${id}`);
    if (info.head_sha !== head) fail('Reported workflow belongs to a different PR head.');
    runs.set(id, info);
  }
  // Opened/labeled events can cancel each other's runs. Ignore only entire cancelled
  // runs that have a non-cancelled replacement for this same workflow and head.
  // A failed run, cancelled standalone check or approval-required run still blocks.
  const checks = reported.filter((check) => {
    const info = runs.get(runId(check));
    return (
      info?.conclusion !== 'cancelled' ||
      ![...runs.values()].some(
        (other) =>
          other.id !== info.id &&
          other.workflow_id === info.workflow_id &&
          other.conclusion !== 'cancelled',
      )
    );
  });
  const pending = checks.some((check) => check.bucket === 'pending');
  const invalid = checks.filter(
    (check) =>
      check.bucket !== 'pass' &&
      check.bucket !== 'pending' &&
      !(
        check.bucket === 'skipping' &&
        !isRelease &&
        (check.name === 'Candidate Packages' || check.name.startsWith('Candidate Packages /'))
      ),
  );
  if (invalid.length) fail(`PR checks did not pass: ${JSON.stringify(invalid)}`);
  if (!checks.length) fail('No checks reported for the current PR.');
  if (!pending) break;
  if (attempt === 39)
    fail('Checks are pending or require GitHub workflow approval; leave PR open.');
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
pr = api(`repos/${repo}/pulls/${number}`);
if (!ready(pr)) fail('PR changed while waiting; fresh checks required.');
if (
  !/^(feat|fix|docs|chore|refactor|perf|test|style|build|revert|ci)(\([a-z0-9-]+\))?!?: .+/.test(
    pr.title,
  )
)
  fail('Invalid PR title.');
const result = api(
  `repos/${repo}/pulls/${number}/merge`,
  '--method',
  'PUT',
  '-f',
  `sha=${head}`,
  '-f',
  'merge_method=squash',
  '-f',
  `commit_title=${pr.title} (#${number})`,
);
if (!result.merged) fail(result.message);
console.log(`Merged PR #${number}: ${result.sha}`);
run('gh', ['workflow', 'run', 'ci.yml', '--repo', repo, '--ref', 'main']);
if (isRelease)
  run('gh', [
    'workflow',
    'run',
    'release.yml',
    '--repo',
    repo,
    '--ref',
    'main',
    '-f',
    `pr_number=${number}`,
  ]);
