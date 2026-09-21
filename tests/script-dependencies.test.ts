import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  access,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compileScript,
  inspectScriptPackage,
  verifyScriptBundle,
} from '../src/adapters/script-bundle';
import { validateFlow, validateObject } from '../src/core/validate';
import { validateDependency } from '../src/core/script-dependencies';
import { packageFlow, instantiate, validateTemplate } from '../src/templates/flow';
import { validateIPC } from '../src/shared/ipc';
import type { Flow } from '../src/shared/types';

async function file(root: string, name: string, content: string) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await writeFile(join(root, name), content);
}
const script = {
  id: 'script',
  type: 'script' as const,
  version: 1 as const,
  language: 'ts' as const,
  code: 'export default async()=>1',
  input: null,
  dependencies: [{ name: '@fixture/main', version: '1.2.3' }],
};
const flow: Flow = {
  id: 'dependencies',
  name: '本地依赖测试',
  description: '',
  formatVersion: '1.0',
  parameters: {},
  requiredCapabilities: ['script'],
  steps: [script],
};

test('exact declarations and template manifest cannot omit, duplicate or substitute script dependencies', () => {
  for (const version of ['latest', '^1.2.3', '1.x', '01.2.3', '1.2.3-01', 'file:../pkg'])
    assert.throws(() => validateDependency({ name: 'test', version }), /精确版本/);
  validateDependency({ name: '@scope/name', version: '1.0.0-rc.1+build.22' });
  for (const name of ['../pkg', 'pkg/child', '@scope/../pkg', '__proto__', '/tmp/pkg'])
    assert.throws(() => validateDependency({ name, version: '1.0.0' }), /包名/);
  validateFlow(flow);
  assert.throws(
    () =>
      validateFlow({
        ...flow,
        steps: [{ ...script, dependencies: [...script.dependencies, ...script.dependencies] }],
      }),
    /重复/,
  );
  assert.throws(
    () =>
      validateFlow({
        ...flow,
        steps: [
          script,
          { ...script, id: 'other', dependencies: [{ name: '@fixture/main', version: '2.0.0' }] },
        ],
      }),
    /冲突/,
  );
  const template = packageFlow(flow);
  assert.deepEqual(template.manifest.dependencies, script.dependencies);
  assert.deepEqual(instantiate(template).steps, flow.steps);
  assert.throws(
    () => validateTemplate({ ...template, manifest: { ...template.manifest, dependencies: [] } }),
    /依赖声明/,
  );
  assert.throws(
    () => validateTemplate({ ...template, manifest: { ...template.manifest, scripts: [] } }),
    /脚本清单/,
  );
  assert.throws(
    () =>
      validateTemplate({
        ...template,
        manifest: { ...template.manifest, scripts: ['script', 'script'] },
      }),
    /脚本清单/,
  );
  validateObject('ScriptBundle', {
    nodeId: 'script',
    sha256: 'a'.repeat(64),
    dependencies: script.dependencies,
  });
  assert.throws(() =>
    validateObject('ScriptBundle', { nodeId: 'script', sha256: 'bad', dependencies: [] }),
  );
  assert.throws(() => validateIPC('script.package.inspect', { path: '/tmp/pkg', run: true }));
});

test('local package inspection never executes code; static CJS, transitive JSON and scoped ESM exports are frozen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-packages-'));
  const pkg = join(root, 'pkg');
  const marker = join(root, 'should-not-exist');
  try {
    await file(
      pkg,
      'package.json',
      JSON.stringify({
        name: '@fixture/main',
        version: '1.2.3',
        main: 'index.cjs',
        exports: { '.': './index.cjs', './extra': './extra.mjs' },
        dependencies: { leaf: '^2.0.0' },
        scripts: { postinstall: 'exit 91' },
      }),
    );
    await file(
      pkg,
      'index.cjs',
      `const path=require('node:path'); const leaf=require('leaf'); module.exports={name:path.basename('/tmp/value'),n:leaf.n};`,
    );
    await file(
      pkg,
      'extra.mjs',
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'ran'); export const extra=7;`,
    );
    await file(
      pkg,
      'node_modules/leaf/package.json',
      JSON.stringify({ name: 'leaf', version: '2.4.0', main: 'index.js' }),
    );
    await file(pkg, 'node_modules/leaf/index.js', `module.exports=require('./dist/values.json')`);
    await file(pkg, 'node_modules/leaf/dist/package.json', '{"type":"commonjs"}');
    await file(pkg, 'node_modules/leaf/dist/values.json', '{"n":4}');
    const inspected = await inspectScriptPackage(pkg);
    assert.equal(inspected.name, '@fixture/main');
    await assert.rejects(access(marker));
    const options = {
      code: `import main from '@fixture/main'; import {extra} from '@fixture/main/extra'; export default async()=>({...main,extra});`,
      language: 'ts',
      dependencies: script.dependencies,
      bindings: { '@fixture/main': { path: pkg, version: '1.2.3' } },
      directory: join(root, 'compiled'),
    };
    const bundle = await compileScript(options);
    await assert.rejects(access(marker));
    assert.deepEqual(bundle.dependencies, [
      { name: '@fixture/main', version: '1.2.3' },
      { name: 'leaf', version: '2.4.0' },
    ]);
    assert.equal(
      (await compileScript(options)).sha256,
      bundle.sha256,
      'identical inputs have stable bundle hash',
    );
    await rm(pkg, { recursive: true });
    await verifyScriptBundle(bundle.path, bundle.sha256);
    const result = await import(pathToFileURL(bundle.path).href);
    assert.deepEqual(await result.default(), { name: 'value', n: 4, extra: 7 });
    assert.equal(await readFile(marker, 'utf8'), 'ran');
    await writeFile(bundle.path, 'throw new Error("tampered")');
    await assert.rejects(verifyScriptBundle(bundle.path, bundle.sha256), /摘要不匹配/);
    assert.ok((await readdir(join(root, 'compiled'))).every((p) => !p.startsWith('.prepare-')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unbound, wrong version, undeclared, dynamic and native dependencies fail before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-package-rejections-'));
  const pkg = join(root, 'pkg');
  try {
    await file(
      pkg,
      'package.json',
      JSON.stringify({ name: '@fixture/main', version: '1.2.3', main: 'index.js' }),
    );
    await file(pkg, 'index.js', 'exports.value=2');
    const options = {
      code: "import m from '@fixture/main'; export default()=>m",
      language: 'js',
      dependencies: script.dependencies,
      bindings: { '@fixture/main': { path: pkg, version: '1.2.3' } },
      directory: join(root, 'compiled'),
    };
    await assert.rejects(compileScript({ ...options, bindings: {} }), /未绑定/);
    await assert.rejects(
      compileScript({ ...options, bindings: { '@fixture/main': { path: pkg, version: '9.0.0' } } }),
      /版本不匹配/,
    );
    await assert.rejects(
      compileScript({
        ...options,
        dependencies: [{ name: 'wrong', version: '1.2.3' }],
        bindings: { wrong: { path: pkg, version: '1.2.3' } },
      }),
      /名称或版本不匹配/,
    );
    await assert.rejects(compileScript({ ...options, dependencies: [] }), /未声明/);
    await assert.rejects(
      compileScript({
        ...options,
        dependencies: [],
        code: "import m from 'exceljs';export default()=>m",
      }),
      /未声明/,
    );
    await file(pkg, 'index.js', "module.exports=require('exceljs')");
    await assert.rejects(
      compileScript(options),
      /Could not resolve.*exceljs/,
      'never resolve a missing package from the client installation',
    );
    await file(pkg, 'index.js', 'exports.value=2');
    await assert.rejects(
      compileScript({ ...options, code: 'export default async({input})=>import(input.path)' }),
      /静态固定/,
    );
    await assert.rejects(
      compileScript({ ...options, code: 'export default ({input})=>require(input.path)' }),
      /静态固定/,
    );
    await file(pkg, 'index.js', "module.exports=require('./binding.node')");
    await file(pkg, 'binding.node', 'native extension fixture');
    await assert.rejects(compileScript(options), /不支持此静态文件类型/);
    await assert.rejects(inspectScriptPackage(join(root, 'missing')));
    await assert.rejects(inspectScriptPackage(join(pkg, 'index.js')), /包目录/);
    assert.deepEqual(
      await readdir(join(root, 'compiled')),
      [],
      'failed compilation leaves no runnable artifact or temporary workspace',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('already installed pnpm-style symlinks resolve static transitive dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-linked-package-'));
  try {
    const pkg = join(root, 'store/main');
    const leaf = join(root, 'store/leaf');
    await file(
      pkg,
      'package.json',
      JSON.stringify({ name: 'main', version: '1.0.0', main: 'index.ts' }),
    );
    await file(pkg, 'index.ts', 'import leaf from "leaf"; export default leaf+1;');
    await file(
      leaf,
      'package.json',
      JSON.stringify({ name: 'leaf', version: '2.0.0', main: 'index.js' }),
    );
    await file(leaf, 'index.js', 'module.exports=8');
    await mkdir(join(root, 'node_modules'));
    await mkdir(join(pkg, 'node_modules'));
    await symlink(pkg, join(root, 'node_modules/main'));
    await symlink(leaf, join(pkg, 'node_modules/leaf'));
    const bundle = await compileScript({
      code: 'import value from "main"; export default async()=>value;',
      language: 'ts',
      dependencies: [{ name: 'main', version: '1.0.0' }],
      bindings: { main: { path: join(root, 'node_modules/main'), version: '1.0.0' } },
      directory: join(root, 'compiled'),
    });
    await rm(join(root, 'store'), { recursive: true });
    assert.equal(await (await import(pathToFileURL(bundle.path).href)).default(), 9);
    assert.deepEqual(bundle.dependencies, [
      { name: 'leaf', version: '2.0.0' },
      { name: 'main', version: '1.0.0' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
