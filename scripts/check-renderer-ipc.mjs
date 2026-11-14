import { build, transform } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Module } from 'node:module';

// Tokenize transformed JS, skipping comments (removed by esbuild) and consuming
// entire string literals. Text examples inside UI strings cannot become calls.
function tokens(source) {
  return [...source.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|[^\s]/g)].map(
    (match) => match[0],
  );
}
function constantString(token) {
  return token?.match(/^["']([a-z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+)["']$/)?.[1];
}
async function javascript(path) {
  return (
    await transform(await readFile(path, 'utf8'), {
      loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.jsx') ? 'jsx' : 'ts',
      target: 'es2022',
      supported: { 'template-literal': false },
      legalComments: 'none',
    })
  ).code;
}
export async function checkRendererIPC(root = resolve(import.meta.dirname, '..')) {
  // Load only the trusted schema registry, never Main/host or Electron code.
  const compiled = await build({
    entryPoints: [join(root, 'src/shared/ipc.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const registry = new Module(join(root, 'src/shared/ipc.ts'));
  registry._compile(compiled.outputFiles[0].text, join(root, 'src/shared/ipc.ts'));
  const declared = new Set(Object.keys(registry.exports.methods));
  const preload = await javascript(join(root, 'src/main/preload.ts'));
  const literal = preload.match(
    /const allowed = (?:\/\* @__PURE__ \*\/ )?new Set\(\[([\s\S]*?)\]\);/,
  );
  if (!literal) throw Error('Preload allowed must remain an explicit literal Set for IPC checking');
  const allowed = new Set(JSON.parse('[' + literal[1].replace(/,\s*$/, '') + ']'));
  const missing = new Map(),
    undeclared = new Set(),
    checked = new Set();
  const renderer = join(root, 'src/renderer');
  for (const file of await readdir(renderer, { recursive: true })) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue;
    const path = join(renderer, file),
      list = tokens(await javascript(path));
    for (let i = 0; i + 3 < list.length; i++) {
      if (!['api', 'request', 'call'].includes(list[i]) || list[i + 1] !== '(') continue;
      const endpoint = constantString(list[i + 2]);
      if (!endpoint || ![',', ')'].includes(list[i + 3])) continue;
      if (!declared.has(endpoint)) {
        undeclared.add(endpoint);
        continue;
      }
      checked.add(endpoint);
      if (!allowed.has(endpoint)) {
        if (!missing.has(endpoint)) missing.set(endpoint, new Set());
        missing.get(endpoint).add(relative(root, path));
      }
    }
  }
  if (undeclared.size)
    console.warn(
      'Renderer constant endpoints outside IPC schema (review only, no grant): ' +
        [...undeclared].sort().join(', '),
    );
  if (missing.size)
    throw Error(
      'Renderer IPC missing from Preload allowed:\n' +
        [...missing]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, files]) => `  ${name}: ${[...files].join(', ')}`)
          .join('\n'),
    );
  console.log(
    `Renderer IPC whitelist: ${checked.size} declared constant endpoints checked; no missing grants. Dynamic endpoint construction is outside this check.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await checkRendererIPC();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
