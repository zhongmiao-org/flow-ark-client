import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { child, killOwnedTree } from '../host/processes';
import { Rpc } from '../shared/rpc';
export async function compileScript(code: string, language: string, path: string) {
  const result = await build({
    stdin: {
      contents: code,
      loader: language === 'ts' ? 'ts' : 'js',
      sourcefile: 'trusted-script.' + language,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'silent',
    plugins: [
      {
        name: 'fixed-dependencies',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.path.startsWith('node:') || builtinModules.includes(a.path))
              return { path: a.path, external: true };
            return {
              errors: [{ text: '未声明或未安装的脚本依赖：' + a.path }],
            };
          });
        },
      },
    ],
  });
  if (result.warnings.length)
    throw new Error('脚本依赖无法静态固定：' + result.warnings.map((w) => w.text).join(';'));
  await writeFile(path, result.outputFiles[0].text, { mode: 0o600 });
}
export async function runScript(options: {
  compiled: string;
  input: any;
  dir: string;
  executable: string;
  signal: AbortSignal;
  call: (method: string, args: any) => Promise<any>;
}) {
  options.signal.throwIfAborted();
  const proc = child(join(options.dir, 'script.cjs'), options.executable);
  const rpc = new Rpc((m) => proc.send(m), options.call);
  proc.on('message', (m) => void rpc.receive(m as any));
  proc.on('exit', () => rpc.close());
  proc.on('error', () => rpc.close());
  const cancel = () => {
    if (proc.connected) proc.send({ control: 'cancel' }, () => {});
    void killOwnedTree(proc);
  };
  process.once('disconnect', cancel);
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    return await rpc.call('execute', { path: options.compiled, input: options.input }, 3600000);
  } finally {
    options.signal.removeEventListener('abort', cancel);
    process.removeListener('disconnect', cancel);
    await killOwnedTree(proc);
    rpc.close();
  }
}
