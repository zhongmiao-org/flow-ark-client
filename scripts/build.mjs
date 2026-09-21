import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rm, mkdir, copyFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('dist/licenses', { recursive: true });
for (const font of ['inter', 'noto-sans-sc']) {
  await copyFile(
    `node_modules/@fontsource-variable/${font}/LICENSE`,
    `dist/licenses/${font}-OFL.txt`,
  );
}
await build({
  entryPoints: {
    main: 'src/main/main.ts',
    preload: 'src/main/preload.ts',
    host: 'src/host/entry.ts',
    worker: 'src/workers/runner.ts',
    browser: 'src/workers/browser.ts',
    script: 'src/workers/script.ts',
    'script-supervisor': 'src/workers/script-supervisor.ts',
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
await viteBuild({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: false },
  server: { host: '127.0.0.1' },
});
