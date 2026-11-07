import './generate-node-validator.mjs';
import './generate-desktop-sdk.mjs';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rm, mkdir, copyFile, readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
  await promisify(execFile)('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-O', '-module-cache-path', 'dist/native-module-cache', 'native/DesktopAutomation.swift', '-o', 'dist/native/flowark-desktop-automation'], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  await rm('dist/native-module-cache', { recursive: true, force: true });
}
const resolveBuild = createRequire(import.meta.url);
await mkdir('dist/native', { recursive: true });
const compilerPackage = dirname(createRequire(resolveBuild.resolve('typescript/package.json')).resolve('@typescript/typescript-' + process.platform + '-' + process.arch + '/package.json'));
await copyFile(join(compilerPackage, 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc'), 'dist/native/flowark-typescript' + (process.platform === 'win32' ? '.exe' : ''));
for(const file of await readdir(join(compilerPackage,'lib')))if(file.endsWith('.d.ts'))await copyFile(join(compilerPackage,'lib',file),join('dist/native',file));
await promisify(execFile)('dist/native/flowark-typescript'+(process.platform==='win32'?'.exe':''),['--version'],{timeout:10000});
for (const [name, root] of Object.entries({typescript: dirname(resolveBuild.resolve('typescript/package.json')) + '/lib', node: dirname(resolveBuild.resolve('@types/node/package.json')), 'undici-types': dirname(createRequire(resolveBuild.resolve('@types/node/package.json')).resolve('undici-types/package.json'))})) {
  for (const file of await readdir(root, {recursive:true})) if (file.endsWith('.d.ts') || file === 'package.json') {
    const target=join('dist/types',name,file); await mkdir(dirname(target),{recursive:true}); await copyFile(join(root,file),target);
  }
}
await mkdir('dist/skills/flowark-project-author', { recursive: true });
await copyFile('resources/skills/flowark-project-author/SKILL.md', 'dist/skills/flowark-project-author/SKILL.md');
await mkdir('dist/licenses', { recursive: true });
for (const font of ['inter', 'noto-sans-sc']) {
  await copyFile(
    `node_modules/@fontsource-variable/${font}/LICENSE`,
    `dist/licenses/${font}-OFL.txt`,
  );
}
await copyFile('node_modules/pdfjs-dist/LICENSE', 'dist/licenses/pdfjs-dist-LICENSE.txt');
await copyFile('third-party/saxes-LICENSE.txt', 'dist/licenses/saxes-LICENSE.txt');
await copyFile('third-party/node-types-LICENSE.txt', 'dist/licenses/node-types-LICENSE.txt');
for (const [name, license] of [
  ['react-markdown', 'license'],
  ['remark-gfm', 'license'],
  ['mermaid', 'LICENSE'],
  ['dompurify', 'LICENSE'],
]) {
  await copyFile(`node_modules/${name}/${license}`, `dist/licenses/${name}-LICENSE.txt`);
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
    'document-supervisor': 'src/workers/document-supervisor.ts',
    project: 'src/projects/cli.ts',
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
const nodeEditorTypes = {};
for (const name of await readdir('node_modules/@types/node', { recursive: true })) {
  if (name.endsWith('.d.ts')) nodeEditorTypes['node_modules/@types/node/' + name] = await readFile('node_modules/@types/node/' + name, 'utf8');
}
if (Object.keys(nodeEditorTypes).length < 10) throw Error('Missing bundled Node editor types');
await viteBuild({
  plugins: [{ name: 'flowark-node-editor-types', resolveId(id) { if (id === 'virtual:flowark-node-types') return '\0flowark-node-types'; },
    load(id) { if (id === '\0flowark-node-types') return 'export default ' + JSON.stringify(nodeEditorTypes); } }],
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: false },
  server: { host: '127.0.0.1' },
});
