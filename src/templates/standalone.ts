import { build } from 'esbuild';
import { isBuiltin } from 'node:module';
import type { PackageData } from '../../contracts/package-format';

/** A packaged script is materialized independently; no adjacent files or npm install. */
export async function assertStandalonePackage(pkg: PackageData) {
  const readme = pkg.files.get('README.md');
  if (!readme || !new TextDecoder('utf-8', { fatal: true }).decode(readme).trim())
    throw Error('导出包须包含非空 README 使用说明，请在模板制作工作区补全');
  for (const path of pkg.manifest.scripts) {
    const result = await build({
      stdin: { contents: pkg.files.get(path)!.toString('utf8'), sourcefile: path, loader: 'js' },
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
      plugins: [
        {
          name: 'complete-template-script',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
              if (isBuiltin(args.path)) return { path: args.path, external: true };
              throw Error(
                `脚本 ${path} 依赖 ${args.path}，须先静态打包，不能依赖本机文件或运行时安装`,
              );
            });
          },
        },
      ],
    });
    if (result.warnings.length)
      throw Error(`脚本 ${path} 无法静态固定：${result.warnings.map((w) => w.text).join('；')}`);
  }
}
