import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { artifactNames } from './release/common.mjs';
import { verifyBundle } from './verify-bundle.mjs';
const [platform = 'macos', arch = 'arm64'] = process.argv.slice(2);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const names = artifactNames(version, platform, arch);
const host = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];
if (platform !== host || arch !== process.arch)
  throw new Error('Package on a native runner matching the target platform and architecture.');
const exec = (file, args) => execFileSync(file, args, { stdio: 'inherit' });
// Keep unrelated local release candidates; clean only this invocation's isolated output.
const output = `release/packages/${platform}-${arch}`;
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
exec(process.execPath, ['scripts/build.mjs']);
const target =
  platform === 'macos'
    ? ['--mac', 'zip']
    : platform === 'windows'
      ? ['--win', 'nsis', 'zip']
      : ['--linux', 'AppImage', 'deb'];
const args = [
  'node_modules/electron-builder/cli.js',
  ...target,
  `--${arch}`,
  '--publish',
  'never',
  '--config.electronDist=node_modules/electron/dist',
  `--config.directories.output=${output}`,
];
exec(process.execPath, args);
if (platform === 'macos') {
  const app = join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', 'FlowArk.app');
  await verifyBundle(app);
  for (const binary of [
    'Contents/MacOS/FlowArk',
    'Contents/Resources/app.asar.unpacked/dist/native/flowark-window-discovery',
  ])
    exec('/usr/bin/lipo', ['-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64', join(app, binary)]);
  const bundledVersion = execFileSync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();
  if (bundledVersion !== version) throw new Error('macOS bundle version mismatch.');
  exec(process.execPath, ['scripts/package-dmg.mjs', arch, output]);
} else {
  const executable = join(
    output,
    platform === 'windows' ? 'win-unpacked/FlowArk.exe' : 'linux-unpacked/flowark',
  );
  const bytes = readFileSync(executable);
  if (platform === 'windows') {
    const offset = bytes.readUInt32LE(0x3c);
    if (
      bytes.toString('ascii', 0, 2) !== 'MZ' ||
      bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' ||
      bytes.readUInt16LE(offset + 4) !== 0x8664
    )
      throw new Error('Windows executable is not x64 PE.');
  } else if (
    bytes.toString('hex', 0, 4) !== '7f454c46' ||
    bytes[4] !== 2 ||
    bytes.readUInt16LE(18) !== 62
  )
    throw new Error('Linux executable is not x64 ELF.');
}
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { extractFile } = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const asarPath =
  platform === 'macos'
    ? join(
        output,
        arch === 'arm64' ? 'mac-arm64' : 'mac',
        'FlowArk.app/Contents/Resources/app.asar',
      )
    : join(
        output,
        platform === 'windows' ? 'win-unpacked' : 'linux-unpacked',
        'resources/app.asar',
      );
if (JSON.parse(extractFile(asarPath, 'package.json').toString()).version !== version)
  throw new Error('Packaged application version mismatch.');
const assets = join(output, 'assets');
mkdirSync(assets);
const sums = [];
for (const name of names.slice(0, 2)) {
  const bytes = readFileSync(join(output, name));
  if (!bytes.length) throw new Error(`Empty package: ${name}`);
  copyFileSync(join(output, name), join(assets, name));
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
writeFileSync(join(assets, names[2]), sums.join('\n') + '\n');
console.log(`Verified ${platform}/${arch} ${version}; release assets: ${assets}`);
