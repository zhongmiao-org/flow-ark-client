import { readFileSync, writeFileSync } from 'node:fs';
import {
  files,
  fail,
  git,
  readAt,
  loadChangelogs,
  parseChangelog,
  substance,
  validateRelease,
  packageVersion,
  compareVersions,
  releaseVersion,
  output,
} from './common.mjs';
const mode = process.argv[2] ?? 'check';
if (mode === 'prepare') {
  const version = process.env.VERSION;
  const current = packageVersion();
  const logs = loadChangelogs();
  const sameInitial =
    version === current &&
    current === '0.3.0' &&
    logs.every((log) => log.length === 1) &&
    !git('tag', '--list', 'v*');
  if (compareVersions(version, current) <= 0 && !sameInitial)
    fail(`Target ${version} must be greater than ${current}.`);
  if (git('tag', '--list', `v${version}`)) fail(`Tag v${version} already exists.`);
  const date = new Date().toISOString().slice(0, 10);
  logs.forEach((log, i) => {
    if (!substance(log[0].body)) fail(`${files[i]}: Unreleased is empty; add release notes first.`);
    const content = readFileSync(files[i], 'utf8');
    writeFileSync(
      files[i],
      content.replace(
        /^## \[Unreleased\][\s\S]*?(?=^## \[|(?![\s\S]))/m,
        `## [Unreleased]\n\n## [${version}] - ${date}\n\n${log[0].body}\n\n`,
      ),
    );
  });
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  pkg.version = version;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  validateRelease(version);
  output({ version });
} else if (mode === 'release') {
  validateRelease(process.env.VERSION, process.env.BASE_SHA || undefined);
  console.log('Release version and bilingual archive are consistent.');
} else if (mode === 'check') {
  const logs = loadChangelogs();
  const base = process.env.BASE_SHA;
  const branch = process.env.PR_BRANCH ?? '';
  const labels = JSON.parse(process.env.PR_LABELS || '[]');
  if (!base) {
    console.log('Changelog structure and version consistency passed.');
    process.exit(0);
  }
  const basePackage = JSON.parse(readAt(base, 'package.json'));
  const isRelease = branch.startsWith('build/release-v') || labels.includes('release');
  if (isRelease) {
    const version = releaseVersion(branch);
    const before = files.map((file) => parseChangelog(readAt(base, file), file));
    const sameInitial =
      version === '0.3.0' &&
      version === basePackage.version &&
      before.every((log) => log.length === 1) &&
      !git('tag', '--list', 'v*');
    if (compareVersions(version, basePackage.version) <= 0 && !sameInitial)
      fail('Release version must increase (except the first 0.3.0 release).');
    validateRelease(version, base);
  } else {
    if (basePackage.version !== packageVersion())
      fail('Change application versions only through prepare-release.');
    const exempt = process.env.PR_AUTHOR === 'dependabot[bot]' || labels.includes('skip changelog');
    files.forEach((file, i) => {
      const oldContent = readAt(base, file);
      // Bootstrap the watchdog in a repository that has no changelogs yet.
      const before = oldContent
        ? parseChangelog(oldContent, file)
        : [{ version: 'Unreleased', body: '' }];
      if (
        !labels.includes('changelog correction') &&
        JSON.stringify(before.slice(1)) !== JSON.stringify(logs[i].slice(1))
      )
        fail(
          `${file}: released notes are protected; use changelog correction for a deliberate correction.`,
        );
      if (
        !exempt &&
        (!substance(logs[i][0].body) || substance(before[0].body) === substance(logs[i][0].body))
      )
        fail(
          `${file}: update substantive Unreleased notes; whitespace/category-only edits do not count.`,
        );
    });
  }
  console.log('Bilingual changelog watchdog passed.');
} else fail(`Unknown changelog mode: ${mode}`);
