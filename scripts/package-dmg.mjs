import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { verifyBundle } from './verify-bundle.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec = promisify(execFile);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const stage = await mkdtemp(join(tmpdir(), 'flowark-dmg-'));
try {
  // ditto preserves framework-relative symlinks when staging a relocatable .app.
  await exec('/usr/bin/ditto', [
    resolve('release/mac-arm64/FlowArk.app'),
    join(stage, 'FlowArk.app'),
  ]);
  await verifyBundle(join(stage, 'FlowArk.app'));
  await symlink('/Applications', join(stage, 'Applications'));
  const output = resolve(`release/FlowArk-${version}-arm64.dmg`);
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
