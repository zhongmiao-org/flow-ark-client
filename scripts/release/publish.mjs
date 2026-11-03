import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  findRelease,
  api,
  fail,
  run,
  git,
  assertSha,
  allArtifactNames,
  compareVersions,
} from './common.mjs';
const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.TAG;
const version = tag?.replace(/^v/, '');
const sha = assertSha(process.env.RELEASE_SHA);
git('fetch', 'origin', `refs/tags/${tag}`);
if (git('rev-parse', `${tag}^{commit}`) !== sha) fail('Release tag changed before upload.');
const expected = allArtifactNames(version).sort();
const actual = readdirSync('.release/assets').sort();
if (JSON.stringify(actual) !== JSON.stringify(expected))
  fail(`Release assets incomplete: expected ${expected.join(', ')}, got ${actual.join(', ')}.`);
const digests = new Map();
for (const name of expected) {
  const bytes = readFileSync(`.release/assets/${name}`);
  if (!bytes.length) fail(`Empty release asset: ${name}`);
  digests.set(name, createHash('sha256').update(bytes).digest('hex'));
}
for (const name of expected.filter((n) => n.endsWith('-SHA256SUMS.txt'))) {
  const lines = readFileSync(`.release/assets/${name}`, 'utf8').trim().split('\n');
  const siblings = expected.filter((n) => n.startsWith(name.replace('-SHA256SUMS.txt', '.')));
  if (lines.length !== 2 || siblings.length !== 2) fail(`Invalid checksum manifest: ${name}`);
  const wanted = siblings.map((n) => `${digests.get(n)}  ${n}`).sort();
  if (JSON.stringify(lines.sort()) !== JSON.stringify(wanted)) fail(`Checksum mismatch: ${name}`);
}
let release = findRelease(repo, tag);
if (!release) fail('Release draft is missing.');
const releaseId = release.id;
if (!release.draft) fail('Release is already public; refusing to overwrite assets.');
for (const asset of release.assets) {
  if (!expected.includes(asset.name))
    api(`repos/${repo}/releases/assets/${asset.id}`, '--method', 'DELETE');
}
run('gh', [
  'release',
  'upload',
  tag,
  '--repo',
  repo,
  '--clobber',
  ...expected.map((name) => `.release/assets/${name}`),
]);
release = api(`repos/${repo}/releases/${releaseId}`);
if (
  !release.draft ||
  JSON.stringify(release.assets.map((a) => a.name).sort()) !== JSON.stringify(expected)
)
  fail('Draft or uploaded asset set changed.');
for (const asset of release.assets)
  if (asset.digest !== `sha256:${digests.get(asset.name)}`)
    fail(`Uploaded asset digest mismatch: ${asset.name}`);
const pages = JSON.parse(
  run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]),
);
const newer = pages
  .flat()
  .some(
    (r) =>
      !r.draft &&
      !r.prerelease &&
      /^v\d+\.\d+\.\d+$/.test(r.tag_name) &&
      compareVersions(r.tag_name.slice(1), version) >= 0,
  );
run('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', `--latest=${!newer}`]);
const published = api(`repos/${repo}/releases/${releaseId}`);
if (published.draft) fail('Release was not published.');
console.log(`Published ${published.html_url} (${sha}), ${expected.length} verified assets.`);
