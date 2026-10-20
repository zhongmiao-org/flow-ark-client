import {
  chromium,
  type BrowserContext,
  type Page,
  type Frame,
  type Request,
  type JSHandle,
  type ElementHandle,
} from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
import { framePathOf, validateFormCommand } from '../core/browser-command';
import { commandBudget, assertBrowserOperations } from './browser-scope';
import { resolvedBrowserFields, assertBrowserFieldsResult } from '../shared/browser-fields';
import { readBrowserFields, type BrowserFieldsDOMInput } from './browser-fields-dom';
import { readBrowserRenderedFields } from './browser-rendered-fields-dom';
import { browserTargetDOM, browserTargetPointerGuard } from './browser-target-dom';
import { resolvedBrowserTarget, assertBrowserTargetResult } from '../shared/browser-target';
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
    const remaining = commandBudget(
      c.version === 9 || c.version === 10 ? Math.min(c.timeoutMs ?? 15000, 15000) : c.timeoutMs,
    );
    const page = this.page;
    if (c.version === 8) return this.target(c, page, path, remaining);
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
  private async target(c: BrowserCommand, page: Page, path: string[], remaining: () => number) {
    const command = resolvedBrowserTarget(c),
      epoch = this.documentEpoch;
    const handles: JSHandle[] = [];
    const chain: { frame: Frame; selector: string; element: ElementHandle<Element> }[] = [];
    const verify = () => {
      remaining();
      if (
        this.documentEpoch !== epoch ||
        this.page !== page ||
        page.isClosed() ||
        this.navigationRequests.size
      )
        throw Error('网页或框架在派发前已变化，未重新定位');
    };
    const state = async (item: (typeof chain)[number], read = false) => {
      verify();
      const result = await item.frame.evaluate(browserTargetDOM, {
        selector: item.selector,
        expected: item.element,
        mode: read ? ('read' as const) : ('check' as const),
      });
      verify();
      if (!result || !('visible' in result)) throw Error('网页目标状态不可核对');
      return result;
    };
    const bind = async (frame: Frame, selector: string) => {
      for (;;) {
        verify();
        const handle = await frame.evaluateHandle(browserTargetDOM, {
          selector,
          mode: 'bind' as const,
        });
        const element = handle.asElement() as ElementHandle<Element> | null;
        if (element) {
          handles.push(handle);
          return { frame, selector, element };
        }
        await handle.dispose();
        await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
      }
    };
    const visible = async (item: (typeof chain)[number]) => {
      for (;;) {
        for (const ancestor of chain)
          if (!(await state(ancestor)).visible) throw Error('已绑定框架不再可见');
        const result = await state(item);
        if (result.visible) return;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
      }
    };
    try {
      verify();
      let frame = page.mainFrame();
      for (const selector of path) {
        const item = await bind(frame, selector);
        await visible(item);
        const next = await item.element.contentFrame();
        verify();
        if (!next || next.isDetached()) throw Error('目标不是可用框架');
        chain.push(item);
        frame = next;
      }
      const item = await bind(frame, command.selector);
      await visible(item);
      let result: unknown;
      if (command.operation === 'click') {
        // ElementHandle keeps this exact element; never use a re-resolving Locator here.
        for (const ancestor of chain)
          if (!(await state(ancestor)).visible) throw Error('框架不可见');
        if (!(await state(item)).visible) throw Error('目标不可见');
        const guard = await frame.evaluateHandle(browserTargetPointerGuard, {
          selector: item.selector,
          element: item.element,
        });
        try {
          await item.element.click({ timeout: remaining(), noWaitAfter: true });
          let observation;
          try {
            observation = await guard.evaluate((value) => value.read());
          } catch (error) {
            if (this.documentEpoch === epoch) throw error;
          }
          if (observation && (observation.blocked || !observation.pressed))
            throw Error('点击期间固定目标发生变化，结果未确认');
        } finally {
          await guard.evaluate((value) => value.dispose()).catch(() => {});
          await guard.dispose().catch(() => {});
        }
        // Closing a popup or navigation after dispatch must never trigger another click.
        result = { clicked: true, verified: false };
      } else if (command.operation === 'read') {
        const value = await state(item, true);
        if (!value.visible) throw Error('读取目标不再可见');
        result = value.text;
      } else {
        if (!(await state(item)).visible) throw Error('等待目标不再可见');
        result = true;
      }
      assertBrowserTargetResult(command.operation, result);
      return result;
    } finally {
      await Promise.all(handles.map((handle) => handle.dispose().catch(() => {})));
    }
  }
  private async collect(c: BrowserCommand, page: Page, path: string[], remaining: () => number) {
    const node = resolvedBrowserFields({
      id: 'driver',
      type: 'browser',
      version: c.version ?? 5,
      ...(c.version === 9 || c.version === 10 ? { renderPolicy: c.renderPolicy } : {}),
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
          node.version === 10
            ? ('bounded-selection-text-v2' as const)
            : node.version === 9
              ? ('bounded-selection-text-v1' as const)
              : node.version === 7
                ? ('bounded-rendered-text-v2' as const)
                : ('bounded-rendered-text-v1' as const),
      };
      const result =
        node.version === 6 || node.version === 7 || node.version === 9 || node.version === 10
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
