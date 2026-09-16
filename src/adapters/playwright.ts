import { chromium, type BrowserContext, type Page, type Frame } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
import { framePathOf } from '../core/browser-command';
import { commandBudget } from './browser-scope';
export class PlaywrightDriver implements BrowserDriver {
  private constructor(
    private context: BrowserContext,
    private page: Page,
  ) {}
  static async start(b: BrowserBinding, profile: string, headless = false) {
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: b.executable,
      headless,
      acceptDownloads: true,
      timeout: 20000,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    context.on('page', (p) => {
      driver.page = p;
    });
    const driver = new PlaywrightDriver(context, page);
    return driver;
  }
  async perform(c: BrowserCommand): Promise<any> {
    const path = framePathOf(c);
    const remaining = commandBudget(c.timeoutMs);
    const page = this.page;
    let frame: Frame = page.mainFrame();
    for (const selector of path) {
      // Pin this element's frame for this command. A replacement must not receive an old action.
      const handle = await frame.locator('css=' + selector).elementHandle({ timeout: remaining() });
      if (!handle) throw new Error('未找到框架：' + selector);
      try {
        const next = await handle.contentFrame();
        if (!next || next.isDetached()) throw new Error('目标不是可用框架：' + selector);
        frame = next;
      } finally {
        await handle.dispose();
      }
    }
    const loc = frame.locator(c.selector || 'body');
    switch (c.operation) {
      case 'navigate': {
        const u = new URL(String(c.value));
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只支持 HTTP(S) 网页');
        await page.goto(u.href, {
          waitUntil: 'domcontentloaded',
          timeout: remaining(),
        });
        return { url: page.url(), title: await page.title() };
      }
      case 'read':
        return await loc.innerText({ timeout: remaining() });
      case 'count':
        return await loc.count();
      case 'attribute':
        return await loc.getAttribute(String(c.value), { timeout: remaining() });
      case 'click':
        await loc.click({ timeout: remaining() });
        return { clicked: true, verified: false };
      case 'fill':
        await loc.fill(String(c.value), { timeout: remaining() });
        return { filled: true };
      case 'wait':
        await loc.waitFor({ state: 'visible', timeout: remaining() });
        return true;
      case 'upload':
        await loc.setInputFiles(String(c.value), { timeout: remaining() });
        return { selected: true, verified: false };
      case 'screenshot':
        await page.screenshot({
          path: String(c.value),
          fullPage: true,
          timeout: remaining(),
        });
        return true;
      case 'download': {
        const [d] = await Promise.all([
          page.waitForEvent('download', { timeout: remaining() }),
          loc.click({ timeout: remaining() }),
        ]);
        await d.saveAs(String(c.value));
        return { saved: true };
      }
      case 'url':
        return page.url();
      default:
        throw new Error('浏览器不支持此操作');
    }
  }
  async close() {
    await this.context.close();
  }
}
