import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
import { commandBudget } from './browser-scope';
import { PlaywrightDriver } from './playwright';

/** Owns only the dedicated browser process, never the workbench's CDP target. */
export class EmbeddedDriver implements BrowserDriver {
  private constructor(
    private app: ElectronApplication,
    private delegate: PlaywrightDriver,
  ) {}
  static async start(
    binding: BrowserBinding,
    profile: string,
    executable: string,
    appPath: string,
  ) {
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const env: Record<string, string | undefined> = {
      ...process.env,
      FLOWARK_BROWSER_PROFILE: profile,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.FLOWARK_DATA_DIR;
    const app = await electron.launch({
      executablePath: executable,
      args: [appPath, '--flowark-browser'],
      env: Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      timeout: 20000,
    });
    try {
      const page = await app.firstWindow({ timeout: 15000 });
      const driver = new EmbeddedDriver(app, PlaywrightDriver.attach(app.context(), page, binding));
      page.on('dialog', async (dialog) => {
        await dialog.dismiss().catch(() => {});
      });
      return driver;
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  async perform(command: BrowserCommand) {
    if (command.operation !== 'download') return this.delegate.perform(command);
    const remaining = commandBudget(command.timeoutMs);
    await this.app.evaluate(({ BrowserWindow }, path) => {
      const windows = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      (globalThis as any).flowarkDownload = {
        state: 'armed',
        path,
        owner: windows.at(-1)?.webContents.id,
      };
    }, String(command.value));
    try {
      await this.delegate.perform({ ...command, operation: 'click', timeoutMs: remaining() });
      while (true) {
        const state = await this.app.evaluate(() => (globalThis as any).flowarkDownload?.state);
        if (state === 'completed') return { saved: true };
        if (!['armed', 'downloading'].includes(state))
          throw new Error('内置浏览器下载未完成：' + state);
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining())));
      }
    } finally {
      await this.app
        .evaluate(() => {
          const download = (globalThis as any).flowarkDownload;
          if (download?.state !== 'completed') download?.item?.cancel();
          delete (globalThis as any).flowarkDownload;
        })
        .catch(() => {});
    }
  }

  async visibility(visible: boolean) {
    await this.app.evaluate(({ BrowserWindow }, visible) => {
      const windows = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      // Newest page is the automation target; keep older pages in the background.
      for (const window of windows) window.hide();
      if (visible) {
        const window = windows[windows.length - 1];
        window?.restore();
        window?.show();
        window?.focus();
      }
    }, visible);
    return this.status();
  }
  async status() {
    return this.app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      return {
        started: true,
        visible: windows.some((w) => w.isVisible() && !w.isMinimized()),
        url: windows[windows.length - 1]?.webContents.getURL() ?? '',
      };
    });
  }
  async close() {
    await this.app
      .evaluate(async ({ session }) => {
        await session.defaultSession.cookies.flushStore();
        session.defaultSession.flushStorageData();
      })
      .catch(() => {});
    await this.app.close();
  }
}
