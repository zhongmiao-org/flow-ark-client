import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { join, resolve } from 'node:path';
import type { BrowserCommand } from '../../src/shared/types';
export async function embeddedHarness(data: string) {
  const entry = join(data, 'embedded-fixture.cjs');
  await build({
    entryPoints: [resolve('scripts/fixtures/embedded-host.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    target: 'node24',
  });
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [entry],
    env: { ...process.env, FLOWARK_DATA_DIR: data },
    timeout: 30000,
  });
  await app.firstWindow();
  while (!(await app.evaluate(() => !!(globalThis as any).embeddedFixture)))
    await new Promise((r) => setTimeout(r, 30));
  const system = async (method: string, args: any = {}): Promise<any> => {
    if (method === 'credentials.list') return [];
    if (method === 'notification') return true;
    return app.evaluate(
      async (_electron, { method, args }) => {
        if (method === 'browser.embedded.binding') return (globalThis as any).embeddedBinding;
        return (globalThis as any).embeddedFixture.system(method, args);
      },
      { method, args },
    );
  };
  const binding = await system('browser.embedded.binding');
  const token = 'fixture-lease';
  return {
    app,
    system,
    binding,
    start: () => system('browser.embedded.start', { token }),
    perform: (command: BrowserCommand) => system('browser.embedded.perform', { token, command }),
    visibility: (visible: boolean) => system('browser.embedded.visibility', { visible }),
    status: () => system('browser.embedded.status'),
    close: () => system('browser.embedded.close', { token }),
    shutdown: async () => {
      await system('browser.embedded.close');
      await app.close();
    },
  };
}
