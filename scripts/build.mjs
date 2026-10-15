import './generate-node-validator.mjs';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rm, mkdir, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
if (process.platform === 'darwin') {
  await mkdir('dist/native', { recursive: true });
  await mkdir('dist/native-module-cache', { recursive: true });
  await promisify(execFile)(
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-O',
      '-module-cache-path',
      'dist/native-module-cache',
      'native/WindowDiscovery.swift',
      '-o',
      'dist/native/flowark-window-discovery',
    ],
    { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
  );
  await rm('dist/native-module-cache', { recursive: true, force: true });
}
await mkdir('dist/licenses', { recursive: true });
for (const font of ['inter', 'noto-sans-sc']) {
  await copyFile(
    `node_modules/@fontsource-variable/${font}/LICENSE`,
    `dist/licenses/${font}-OFL.txt`,
  );
}
await copyFile('node_modules/pdfjs-dist/LICENSE', 'dist/licenses/pdfjs-dist-LICENSE.txt');
await copyFile('third-party/saxes-LICENSE.txt', 'dist/licenses/saxes-LICENSE.txt');
await build({
  entryPoints: {
    main: 'src/main/main.ts',
    preload: 'src/main/preload.ts',
    host: 'src/host/entry.ts',
    worker: 'src/workers/runner.ts',
    browser: 'src/workers/browser.ts',
    script: 'src/workers/script.ts',
    'script-supervisor': 'src/workers/script-supervisor.ts',
    'document-supervisor': 'src/workers/document-supervisor.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});
await build({
  entryPoints: ['src/workers/document-parser.ts'],
  outfile: 'dist/document-parser.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});
await viteBuild({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: false },
  server: { host: '127.0.0.1' },
});
