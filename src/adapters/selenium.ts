import { Builder, By, Key, until, WebDriver } from 'selenium-webdriver';
import { Executor, HttpClient } from 'selenium-webdriver/http';
import firefox from 'selenium-webdriver/firefox.js';
import safari from 'selenium-webdriver/safari.js';
import { writeFile } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
import { framePathOf, validateFormCommand, formKeys } from '../core/browser-command';
import { commandBudget, assertBrowserOperations } from './browser-scope';
export class SeleniumDriver implements BrowserDriver {
  private busy = false;
  private usable = true;
  private constructor(
    private driver: WebDriver,
    private product: BrowserBinding['product'],
  ) {}
  static async start(b: BrowserBinding) {
    process.env.SE_AVOID_BROWSER_DOWNLOAD = 'true';
    process.env.SE_OFFLINE = 'true';
    if (!b.driver) throw new Error('未绑定本机驱动');
    let builder = new Builder();
    if (b.product === 'firefox')
      builder = builder
        .forBrowser('firefox')
        .setFirefoxOptions(new firefox.Options().setBinary(b.executable))
        .setFirefoxService(new firefox.ServiceBuilder(b.driver));
    else if (b.product === 'safari' && b.driver === '/usr/bin/safaridriver') {
      const service = new safari.ServiceBuilder(b.driver).build();
      const executor = new Executor(service.start().then((url) => new HttpClient(url)));
      const driver = WebDriver.createSession(executor, new safari.Options(), () => service.kill());
      await driver.manage().setTimeouts({ pageLoad: 20000, implicit: 0, script: 15000 });
      return new SeleniumDriver(driver, b.product);
    } else throw new Error('不支持的 Selenium 绑定');
    const driver = await builder.build();
    await driver.manage().setTimeouts({ pageLoad: 20000, implicit: 0, script: 15000 });
    return new SeleniumDriver(driver, b.product);
  }
  async perform(c: BrowserCommand): Promise<any> {
    validateFormCommand(c);
    if (!this.usable || this.busy) throw new Error('浏览器会话不可用或正被占用');
    const path = framePathOf(c);
    assertBrowserOperations({ product: this.product }, [c]);
    const remaining = commandBudget(c.timeoutMs);
    this.busy = true;
    try {
      await this.driver.switchTo().defaultContent();
      for (const selector of path) {
        const element = await this.driver.wait(
          async () => {
            const matches = await this.driver.findElements(By.css(selector));
            if (matches.length > 1) throw new Error('框架匹配不唯一：' + selector);
            return matches[0] ?? false;
          },
          remaining(),
          '未找到框架：' + selector,
        );
        if (!['iframe', 'frame'].includes((await element.getTagName()).toLowerCase()))
          throw new Error('目标不是框架：' + selector);
        await this.driver.switchTo().frame(element);
      }
      return await this.performInFrame(c, remaining);
    } finally {
      try {
        await this.driver.switchTo().defaultContent();
      } catch (error) {
        this.usable = false;
        throw new Error('浏览器框架复位失败，会话已失效', { cause: error });
      } finally {
        this.busy = false;
      }
    }
  }
  private async performInFrame(c: BrowserCommand, remaining: () => number): Promise<any> {
    const by = By.css(c.selector || 'body');
    switch (c.operation) {
      case 'navigate': {
        const u = new URL(String(c.value));
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只支持 HTTP(S)');
        await this.driver.manage().setTimeouts({ pageLoad: remaining() });
        await this.driver.get(u.href);
        return {
          url: await this.driver.getCurrentUrl(),
          title: await this.driver.getTitle(),
        };
      }
      case 'url':
        return this.driver.getCurrentUrl();
      case 'count':
        return (await this.driver.findElements(by)).length;
      case 'screenshot':
        await writeFile(String(c.value), Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        return true;
      case 'download':
        throw new Error('本机 Selenium 下载能力尚未验证');
    }
    const element = await this.driver.wait(until.elementLocated(by), remaining());
    if (c.operation === 'inputValue') {
      if (!['input', 'textarea', 'select'].includes((await element.getTagName()).toLowerCase()))
        throw new Error('inputValue 仅支持原生输入控件');
      return element.getAttribute('value');
    }
    if (['check', 'select', 'press'].includes(c.operation)) {
      await this.driver.wait(until.elementIsVisible(element), remaining());
      await this.driver.wait(until.elementIsEnabled(element), remaining());
    }
    if (c.operation === 'check') {
      const type = await element.getAttribute('type');
      if (
        (await element.getTagName()).toLowerCase() !== 'input' ||
        !['checkbox', 'radio'].includes(type ?? '') ||
        (type === 'radio' && c.value === false)
      )
        throw new Error('check 仅支持原生 checkbox 或选中 radio');
      if ((await element.isSelected()) !== c.value) await element.click();
      const checked = await element.isSelected();
      if (checked !== c.value) throw new Error('勾选结果与目标状态不一致');
      return { checked };
    }
    if (c.operation === 'select') {
      if ((await element.getTagName()).toLowerCase() !== 'select')
        throw new Error('select 仅支持原生下拉框');
      const multiple = await element.getAttribute('multiple');
      const values: string[] = typeof c.value === 'string' ? [c.value] : c.value;
      if (!multiple && values.length !== 1) throw new Error('单选必须指定一个选项');
      const options = await this.driver.wait(
        async () => {
          const found = await element.findElements(By.css('option'));
          const items = await Promise.all(
            found.map(async (option) => ({
              option,
              value: (await option.getAttribute('value')) ?? '',
            })),
          );
          return values.every((value) => items.some((item) => item.value === value))
            ? items
            : false;
        },
        remaining(),
        '下拉选项不存在',
      );
      if (!options) throw new Error('下拉选项不存在');
      for (const value of values)
        if (options.filter((item) => item.value === value).length !== 1)
          throw new Error('下拉选项值不唯一');
      const targets = options.filter((item) => values.includes(item.value));
      for (const item of targets)
        if (!(await item.option.isEnabled())) throw new Error('下拉选项已禁用');
      for (const item of options) {
        const wanted = values.includes(item.value);
        const selected = await item.option.isSelected();
        if (selected !== wanted && (multiple || wanted)) await item.option.click();
      }
      const selected: string[] = [];
      for (const item of options) if (await item.option.isSelected()) selected.push(item.value);
      if (JSON.stringify([...selected].sort()) !== JSON.stringify([...values].sort()))
        throw new Error('下拉选择结果与目标不一致');
      return selected;
    }
    if (c.operation === 'press') {
      const nativeKeys = [
        Key.ARROW_LEFT,
        Key.ARROW_RIGHT,
        Key.ARROW_UP,
        Key.ARROW_DOWN,
        Key.HOME,
        Key.END,
        Key.TAB,
        Key.ENTER,
        Key.ESCAPE,
        Key.SPACE,
        Key.BACK_SPACE,
        Key.DELETE,
      ];
      await element.sendKeys(nativeKeys[formKeys.indexOf(c.value)]);
      return { pressed: true };
    }
    if (c.operation === 'read') return element.getText();
    if (c.operation === 'attribute') return element.getAttribute(String(c.value));
    if (c.operation === 'wait') {
      await this.driver.wait(until.elementIsVisible(element), remaining());
      return true;
    }
    if (c.operation === 'click') {
      await element.click();
      return { clicked: true, verified: false };
    }
    if (c.operation === 'fill') {
      await element.clear();
      await element.sendKeys(String(c.value));
      return { filled: true };
    }
    if (c.operation === 'upload') {
      if ((await this.driver.getCapabilities().then((x) => x.getBrowserName())) === 'safari')
        throw new Error('Safari 上传需单独实测，当前禁止');
      await element.sendKeys(String(c.value));
      return { selected: true, verified: false };
    }
    throw new Error('浏览器不支持此操作');
  }
  async close() {
    this.usable = false;
    await this.driver.quit();
  }
}
