import {
  chromium,
  type BrowserContext,
  type Page,
  type Frame,
  type Request,
  type JSHandle,
} from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
import { framePathOf, validateFormCommand } from '../core/browser-command';
import { commandBudget, assertBrowserOperations } from './browser-scope';
import { resolvedBrowserFields, assertBrowserFieldsResult } from '../shared/browser-fields';
import { readBrowserFields, type BrowserFieldsDOMInput } from './browser-fields-dom';
import { readBrowserRenderedFields } from './browser-rendered-fields-dom';
export class PlaywrightDriver implements BrowserDriver {
  private documentEpoch = 0;
  private navigationRequests = new Set<Request>();
  private constructor(
    private context: BrowserContext,
    private page: Page,
    private binding: BrowserBinding,
  ) {
    this.watchPage(page);
  }
  private watchPage(page: Page) {
    page.on('request', (request) => {
      if (request.isNavigationRequest()) {
        this.documentEpoch++;
        this.navigationRequests.add(request);
      }
    });
    const ended = (request: Request) => this.navigationRequests.delete(request);
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);
    const changed = () => {
      this.documentEpoch++;
    };
    page.on('framenavigated', changed);
    page.on('framedetached', changed);
    page.on('frameattached', changed);
    page.on('close', changed);
    page.on('crash', changed);
  }
  static async start(b: BrowserBinding, profile: string, headless = false) {
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: b.executable,
      headless,
      acceptDownloads: true,
      timeout: 20000,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return PlaywrightDriver.attach(context, page, b);
  }
  static attach(context: BrowserContext, page: Page, b: BrowserBinding) {
    context.on('page', (p) => {
      driver.page = p;
      driver.documentEpoch++;
      driver.watchPage(p);
    });
    const driver = new PlaywrightDriver(context, page, b);
    return driver;
  }
  async perform(c: BrowserCommand): Promise<any> {
    validateFormCommand(c);
    assertBrowserOperations(this.binding, [c]);
    const path = framePathOf(c);
    const remaining = commandBudget(c.timeoutMs);
    const page = this.page;
    if (c.operation === 'collect') return this.collect(c, page, path, remaining);
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
      case 'inputValue':
        return await loc.inputValue({ timeout: remaining() });
      case 'check': {
        await loc.waitFor({ state: 'visible', timeout: remaining() });
        if (!(await loc.isEnabled({ timeout: remaining() }))) throw new Error('勾选目标已禁用');
        const type = await loc.getAttribute('type', { timeout: remaining() });
        if (!['checkbox', 'radio'].includes(type ?? '') || (type === 'radio' && c.value === false))
          throw new Error('check 仅支持原生 checkbox 或选中 radio');
        await loc.setChecked(c.value, { timeout: remaining() });
        const checked = await loc.isChecked({ timeout: remaining() });
        if (checked !== c.value) throw new Error('勾选结果与目标状态不一致');
        return { checked };
      }
      case 'select': {
        const values: string[] = typeof c.value === 'string' ? [c.value] : c.value;
        while (true) {
          const info = await loc.evaluate(
            (element) =>
              element instanceof HTMLSelectElement
                ? {
                    multiple: element.multiple,
                    options: Array.from(element.options).map((option) => ({
                      value: option.value,
                      disabled:
                        option.disabled ||
                        (option.parentElement instanceof HTMLOptGroupElement &&
                          option.parentElement.disabled),
                    })),
                  }
                : null,
            null,
            { timeout: remaining() },
          );
          if (!info) throw new Error('select 仅支持原生下拉框');
          if (!info.multiple && values.length !== 1) throw new Error('单选必须指定一个选项');
          for (const value of values) {
            const matches = info.options.filter((option) => option.value === value);
            if (matches.length > 1) throw new Error('下拉选项值不唯一');
            if (matches[0]?.disabled) throw new Error('下拉选项已禁用');
          }
          if (values.every((value) => info.options.some((option) => option.value === value))) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
        }
        const selected = await loc.selectOption(
          values.map((value) => ({ value })),
          { timeout: remaining() },
        );
        if (JSON.stringify([...selected].sort()) !== JSON.stringify([...values].sort()))
          throw new Error('下拉选择结果与目标不一致');
        return selected;
      }
      case 'press':
        if (!(await loc.isEnabled({ timeout: remaining() }))) throw new Error('按键目标已禁用');
        await loc.press(c.value, { timeout: remaining() });
        return { pressed: true };
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
  private async collect(c: BrowserCommand, page: Page, path: string[], remaining: () => number) {
    const node = resolvedBrowserFields({
      id: 'driver',
      type: 'browser',
      version: c.version ?? 5,
      operation: 'collect',
      selector: c.selector,
      framePath: path,
      fields: c.fields,
    });
    if (this.navigationRequests.size) throw Error('网页正在导航，关联采集未开始');
    const epoch = this.documentEpoch,
      url = page.url();
    const documents: { frame: Frame; handle: JSHandle<Document> }[] = [];
    const verify = () => {
      remaining();
      if (
        this.documentEpoch !== epoch ||
        this.page !== page ||
        page.isClosed() ||
        this.navigationRequests.size ||
        page.url() !== url
      )
        throw Error('采集期间网页或框架发生导航/更换，整次结果未采用');
    };
    try {
      let frame = page.mainFrame();
      documents.push({ frame, handle: await frame.evaluateHandle(() => document) });
      for (const selector of path) {
        verify();
        const element = await frame.evaluateHandle((selector) => {
          const found = document.querySelectorAll(selector);
          if (found.length !== 1 || found[0].tagName !== 'IFRAME')
            throw Error('采集框架须唯一匹配 iframe');
          return found[0];
        }, selector);
        try {
          const next = await element.asElement()?.contentFrame();
          if (!next || next.isDetached()) throw Error('采集框架不可用：' + selector);
          frame = next;
          documents.push({ frame, handle: await frame.evaluateHandle(() => document) });
        } finally {
          await element.dispose();
        }
      }
      verify();
      const request = {
        selector: node.selector,
        fields: node.fields,
        framePath: path,
        url,
        renderPolicy:
          node.version === 7
            ? ('bounded-rendered-text-v2' as const)
            : ('bounded-rendered-text-v1' as const),
      };
      const result =
        node.version === 6 || node.version === 7
          ? await frame.evaluate(readBrowserRenderedFields, request)
          : await frame.evaluate(readBrowserFields, {
              ...request,
              fields: request.fields as BrowserFieldsDOMInput['fields'],
            });
      for (const { frame, handle } of documents)
        if (frame.isDetached() || !(await handle.evaluate((doc) => doc === document)))
          throw Error('采集文档身份已变化，整次结果未采用');
      verify();
      assertBrowserFieldsResult(node, result);
      return result;
    } finally {
      await Promise.all(documents.map((d) => d.handle.dispose().catch(() => {})));
    }
  }
  async close() {
    await this.context.close();
  }
}
