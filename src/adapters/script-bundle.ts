import { build, type Loader } from 'esbuild';
import { isBuiltin } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateDependency, type ScriptDependency } from '../core/script-dependencies';
import type { Bindings } from '../shared/types';

async function packageInfo(path: string) {
  const file = join(path, 'package.json');
  if ((await stat(file)).size > 1024 * 1024) throw new Error('package.json 超过 1 MiB');
  const info = JSON.parse(await readFile(file, 'utf8'));
  return info;
}
export async function inspectScriptPackage(
  selected: string,
): Promise<ScriptDependency & { path: string }> {
  const path = await realpath(selected);
  if (!(await stat(path)).isDirectory()) throw new Error('请选择 package.json 所在的包目录');
  const { name, version } = await packageInfo(path);
  validateDependency({ name, version });
  if (isBuiltin(name)) throw new Error('不能用第三方包覆盖 Node 内置模块：' + name);
  return { name, version, path };
}
export function scriptHash(content: Uint8Array) {
  return createHash('sha256').update(content).digest('hex');
}
export async function verifyScriptBundle(path: string, expected: string) {
  if (!path || !/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('脚本快照缺少编译摘要');
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch {
    throw new Error('固定的脚本编译文件已丢失；请重新保存计划或新建运行');
  }
  if (scriptHash(content) !== expected) throw new Error('脚本编译文件摘要不匹配，已阻止执行');
}

export async function compileScript(options: {
  code: string;
  language: string;
  dependencies: ScriptDependency[];
  bindings: Bindings['scriptPackages'];
  directory: string;
}): Promise<{ path: string; sha256: string; dependencies: ScriptDependency[] }> {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const directory = await realpath(options.directory);
  const workspace = await mkdtemp(join(directory, '.prepare-'));
  const resolved = new Map<string, ScriptDependency>();
  const direct = new Map<string, string>();
  const metadata = new Map<string, Promise<any>>();
  const remember = (info: ScriptDependency) =>
    resolved.set(info.name + '@' + info.version, { name: info.name, version: info.version });
  async function owner(file: string): Promise<any> {
    const directory = dirname(file);
    if (metadata.has(directory)) return metadata.get(directory);
    const pending = (async () => {
      try {
        const info = await packageInfo(directory);
        if (info.name || info.version) return validateDependency(info);
        // A nested package.json may only select ESM/CommonJS mode.
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (dirname(directory) === directory) throw new Error('依赖源文件缺少 package.json：' + file);
      return owner(directory);
    })();
    metadata.set(directory, pending);
    return pending;
  }
  try {
    for (const dep of options.dependencies) {
      validateDependency(dep);
      if (direct.has(dep.name)) throw new Error('节点依赖重复：' + dep.name);
      const binding = Object.hasOwn(options.bindings ?? {}, dep.name)
        ? options.bindings![dep.name]
        : undefined;
      if (!binding) throw new Error('未绑定本地脚本依赖：' + dep.name);
      const info = await inspectScriptPackage(binding.path);
      if (info.name !== dep.name || info.version !== dep.version || binding.version !== dep.version)
        throw new Error('本地脚本依赖名称或版本不匹配：' + dep.name + '@' + dep.version);
      direct.set(dep.name, info.path);
      remember(info);
      const target = join(workspace, 'node_modules', dep.name);
      await mkdir(dirname(target), { recursive: true });
      await symlink(info.path, target, 'dir');
    }
    let inputBytes = 0;
    const result = await build({
      absWorkingDir: workspace,
      entryPoints: ['flowark:entry'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      logLevel: 'silent',
      logOverride: {
        'unsupported-dynamic-import': 'warning',
        'unsupported-require-call': 'warning',
        'require-resolve-not-external': 'warning',
      },
      legalComments: 'inline',
      plugins: [
        {
          name: 'fixed-local-dependencies',
          setup(b) {
            b.onResolve({ filter: /.*/ }, async (a) => {
              if (a.pluginData?.resolving) return;
              if (a.path === 'flowark:entry') return { path: a.path, namespace: 'flowark' };
              // Give statically known CommonJS builtin calls an ESM import. This
              // avoids a runtime require shim and keeps all non-builtin code bundled.
              if (isBuiltin(a.path))
                return a.kind === 'require-call'
                  ? { path: a.path, namespace: 'node-require' }
                  : { path: a.path, external: true };
              if (a.namespace === 'flowark') {
                const name = a.path.startsWith('@')
                  ? a.path.split('/').slice(0, 2).join('/')
                  : a.path.split('/')[0];
                if (!direct.has(name) || a.path.split('/').includes('..'))
                  throw new Error('未声明的脚本依赖：' + a.path);
              }
              const resolution = await b.resolve(a.path, {
                kind: a.kind,
                importer: a.importer,
                resolveDir: a.namespace === 'flowark' ? workspace : a.resolveDir,
                pluginData: { resolving: true },
              });
              if (resolution.external) throw new Error('脚本依赖未能静态打包：' + a.path);
              return resolution;
            });
            b.onLoad({ filter: /.*/, namespace: 'flowark' }, () => ({
              contents: options.code,
              loader: options.language === 'ts' ? 'ts' : 'js',
              resolveDir: workspace,
            }));
            b.onLoad({ filter: /.*/, namespace: 'node-require' }, (a) => ({
              contents: `import builtin from ${JSON.stringify(a.path)}; module.exports = builtin;`,
              loader: 'js',
            }));
            b.onLoad({ filter: /.*/, namespace: 'file' }, async (a) => {
              const extension = extname(a.path);
              const loader = (
                {
                  '.js': 'js',
                  '.mjs': 'js',
                  '.cjs': 'js',
                  '.ts': 'ts',
                  '.mts': 'ts',
                  '.cts': 'ts',
                  '.json': 'json',
                  '': 'js',
                } as Record<string, Loader>
              )[extension];
              if (!loader) throw new Error('脚本依赖不支持此静态文件类型：' + extension);
              const size = (await stat(a.path)).size;
              inputBytes += size;
              if (size > 8 * 1024 * 1024 || inputBytes > 64 * 1024 * 1024)
                throw new Error('脚本依赖超出编译大小限制');
              remember(await owner(a.path));
              return { contents: await readFile(a.path), loader };
            });
          },
        },
      ],
    });
    if (result.warnings.length)
      throw new Error('脚本依赖无法静态固定：' + result.warnings.map((w) => w.text).join(';'));
    const content = result.outputFiles[0].contents;
    const sha256 = scriptHash(content);
    const path = join(directory, sha256 + '.mjs');
    try {
      await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      await verifyScriptBundle(path, sha256);
    }
    return {
      path,
      sha256,
      dependencies: [...resolved.values()].sort((a, b) =>
        (a.name + a.version).localeCompare(b.name + b.version),
      ),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
