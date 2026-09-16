import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
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
    const timeout = c.timeoutMs ?? 15000;
    const loc = this.page.locator(c.selector || 'body');
    switch (c.operation) {
      case 'navigate': {
        const u = new URL(String(c.value));
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只支持 HTTP(S) 网页');
        await this.page.goto(u.href, {
          waitUntil: 'domcontentloaded',
          timeout,
        });
        return { url: this.page.url(), title: await this.page.title() };
      }
      case 'read':
        return await loc.innerText({ timeout });
      case 'count':
        return await loc.count();
      case 'attribute':
        return await loc.getAttribute(String(c.value), { timeout });
      case 'click':
        await loc.click({ timeout });
        return { clicked: true, verified: false };
      case 'fill':
        await loc.fill(String(c.value), { timeout });
        return { filled: true };
      case 'wait':
        await loc.waitFor({ state: 'visible', timeout });
        return true;
      case 'upload':
        await loc.setInputFiles(String(c.value), { timeout });
        return { selected: true, verified: false };
      case 'screenshot':
        await this.page.screenshot({
          path: String(c.value),
          fullPage: true,
          timeout,
        });
        return true;
      case 'download': {
        const [d] = await Promise.all([
          this.page.waitForEvent('download', { timeout }),
          loc.click({ timeout }),
        ]);
        await d.saveAs(String(c.value));
        return { saved: true };
      }
      case 'url':
        return this.page.url();
      default:
        throw new Error('浏览器不支持此操作');
    }
  }
  async close() {
    await this.context.close();
  }
}
