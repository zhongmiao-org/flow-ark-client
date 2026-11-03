import { debugMkdtemp as mkdtemp } from '../src/host/debug-files.mjs';
import { symlink, rm } from 'node:fs/promises';
import { verifyBundle } from './verify-bundle.mjs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec = promisify(execFile);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const arch = process.argv[2] ?? 'arm64';
if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported DMG architecture');
const outputDir = process.argv[3] ?? 'release';
const stage = await mkdtemp('flowark-dmg-', {
  retained: false,
  category: 'temporary',
  purpose: 'DMG 打包暂存',
});
try {
  // ditto preserves framework-relative symlinks when staging a relocatable .app.
  await exec('/usr/bin/ditto', [
    resolve(outputDir, arch === 'arm64' ? 'mac-arm64/FlowArk.app' : 'mac/FlowArk.app'),
    join(stage, 'FlowArk.app'),
  ]);
  await verifyBundle(join(stage, 'FlowArk.app'));
  await symlink('/Applications', join(stage, 'Applications'));
  const output = resolve(outputDir, `FlowArk-${version}-macos-${arch}.dmg`);
  await exec(
    '/usr/bin/hdiutil',
    [
      'create',
      '-volname',
      `FlowArk ${version}`,
      '-srcfolder',
      stage,
      '-format',
      'UDZO',
      '-ov',
      output,
    ],
    { timeout: 180000 },
  );
  console.log('Created', output);
} finally {
  await rm(stage, { recursive: true, force: true });
}
