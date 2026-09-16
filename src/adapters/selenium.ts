import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import { Executor, HttpClient } from 'selenium-webdriver/http';
import firefox from 'selenium-webdriver/firefox.js';
import safari from 'selenium-webdriver/safari.js';
import { writeFile } from 'node:fs/promises';
import type { BrowserBinding, BrowserCommand, BrowserDriver } from '../shared/types';
export class SeleniumDriver implements BrowserDriver {
  private constructor(private driver: WebDriver) {}
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
      return new SeleniumDriver(driver);
    } else throw new Error('不支持的 Selenium 绑定');
    const driver = await builder.build();
    await driver.manage().setTimeouts({ pageLoad: 20000, implicit: 0, script: 15000 });
    return new SeleniumDriver(driver);
  }
  async perform(c: BrowserCommand): Promise<any> {
    const by = By.css(c.selector || 'body');
    const timeout = c.timeoutMs ?? 15000;
    switch (c.operation) {
      case 'navigate': {
        const u = new URL(String(c.value));
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只支持 HTTP(S)');
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
    const element = await this.driver.wait(until.elementLocated(by), timeout);
    if (c.operation === 'read') return element.getText();
    if (c.operation === 'attribute') return element.getAttribute(String(c.value));
    if (c.operation === 'wait') {
      await this.driver.wait(until.elementIsVisible(element), timeout);
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
    await this.driver.quit();
  }
}
