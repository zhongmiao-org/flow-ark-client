import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
export const files = ['CHANGELOG.md', 'CHANGELOG_en.md'];
export function fail(message) {
  throw new Error(message);
}
export function run(command, args, options = {}) {
  return (
    execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    })?.trim() ?? ''
  );
}
export const git = (...args) => run('git', args);
export const api = (path, ...args) => {
  const result = run('gh', ['api', path, ...args]);
  return result ? JSON.parse(result) : null;
};
export function optionalApi(path) {
  try {
    return api(path);
  } catch (error) {
    if (String(error.stderr).includes('(HTTP 404)')) return null;
    throw error;
  }
}
export function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value))) fail(`Multiline output rejected: ${key}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
export function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    fail(`Invalid release version: ${version}`);
  return version.split('.').map(BigInt);
}
export function compareVersions(a, b) {
  const x = versionParts(a),
    y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export const packageVersion = () => JSON.parse(readFileSync('package.json', 'utf8')).version;
export function releaseVersion(branch) {
  const match = /^build\/release-v(.+)$/.exec(branch);
  if (!match) fail('Release PR must use build/release-v<version>.');
  versionParts(match[1]);
  return match[1];
}
export function assertSha(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) fail('A full immutable commit SHA is required.');
  return sha;
}
export function readAt(ref, file) {
  if (!/^[a-f0-9]{40}$/.test(ref)) fail('Base revision must be a full commit SHA.');
  const exists = run('git', ['ls-tree', '--name-only', ref, '--', file]);
  return exists ? git('show', `${ref}:${file}`) + '\n' : null;
}
export function parseChangelog(content, file) {
  if (!content) fail(`${file}: missing file; add both changelogs.`);
  const sections = [...content.matchAll(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?[^\S\n]*$/gm)];
  if (!sections.length || sections[0][1] !== 'Unreleased' || sections[0][2])
    fail(`${file}: first section must be ## [Unreleased].`);
  if ([...content.matchAll(/^## /gm)].length !== sections.length)
    fail(`${file}: invalid version heading.`);
  const seen = new Set();
  return sections.map((match, index) => {
    const [, version, date] = match;
    if (seen.has(version)) fail(`${file}: duplicate version ${version}.`);
    seen.add(version);
    if (index > 0) {
      versionParts(version);
      if (!date || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
        fail(`${file}: invalid or missing release date for ${version}.`);
    }
    const body = content
      .slice(match.index + match[0].length, sections[index + 1]?.index ?? content.length)
      .trim();
    const headings = [...body.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
    if (new Set(headings).size !== headings.length)
      fail(`${file}: duplicate category in ${version}.`);
    if (body && (!headings.length || !substance(body)))
      fail(`${file}: ${version} needs a category and substantive notes.`);
    return { version, date: date ?? '', body };
  });
}
export function substance(body) {
  return body
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
export function loadChangelogs() {
  const logs = files.map((file) => parseChangelog(readFileSync(file, 'utf8'), file));
  const shape = (log) => JSON.stringify(log.map(({ version, date }) => ({ version, date })));
  if (shape(logs[0]) !== shape(logs[1]))
    fail('Chinese/English changelog version sections and dates must match.');
  for (let i = 2; i < logs[0].length; i++)
    if (compareVersions(logs[0][i - 1].version, logs[0][i].version) <= 0)
      fail('Released versions must be in descending order.');
  if (logs[0][1] && logs[0][1].version !== packageVersion())
    fail('package.json must match the newest changelog release.');
  return logs;
}
export function validateRelease(version, baseSha) {
  versionParts(version);
  if (packageVersion() !== version) fail('package.json does not match release branch/version.');
  const logs = loadChangelogs();
  logs.forEach((log, i) => {
    if (log[1]?.version !== version || !substance(log[1].body) || log[0].body)
      fail(`${files[i]}: archive substantive notes under ${version} and leave Unreleased empty.`);
    if (baseSha) {
      const before = parseChangelog(readAt(baseSha, files[i]), files[i]);
      if (
        substance(before[0].body) !== substance(log[1].body) ||
        JSON.stringify(before.slice(1)) !== JSON.stringify(log.slice(2))
      )
        fail(`${files[i]}: release must archive base Unreleased and preserve previous releases.`);
    }
  });
  return logs;
}
export function artifactNames(version, platform, arch) {
  versionParts(version);
  const extensions =
    platform === 'macos'
      ? ['dmg', 'zip']
      : platform === 'windows'
        ? ['exe', 'zip']
        : platform === 'linux'
          ? ['AppImage', 'deb']
          : fail('Unknown platform.');
  if (!['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'].includes(`${platform}-${arch}`))
    fail('Unsupported artifact architecture.');
  const prefix = `FlowArk-${version}-${platform}-${arch}`;
  return [...extensions.map((ext) => `${prefix}.${ext}`), `${prefix}-SHA256SUMS.txt`];
}
export function allArtifactNames(version) {
  return [
    ['macos', 'arm64'],
    ['macos', 'x64'],
    ['windows', 'x64'],
    ['linux', 'x64'],
  ].flatMap(([p, a]) => artifactNames(version, p, a));
}
