import { access, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { BrowserBinding } from '../shared/types';
import { digest } from '../shared/utils';
const exec = promisify(execFile);
const products = {
  chrome: {
    app: 'Google Chrome.app',
    bundle: 'com.google.Chrome',
    binary: 'Google Chrome',
  },
  firefox: {
    app: 'Firefox.app',
    bundle: 'org.mozilla.firefox',
    binary: 'firefox',
  },
  safari: { app: 'Safari.app', bundle: 'com.apple.Safari', binary: 'Safari' },
};
export async function inspectBrowser(path: string, driver?: string): Promise<BrowserBinding> {
  const resolved = await realpath(path);
  const index = resolved.indexOf('.app/');
  const appPath = resolved.endsWith('.app')
    ? resolved
    : index >= 0
      ? resolved.slice(0, index + 4)
      : '';
  if (!appPath) throw new Error('请选择已安装的 Chrome、Firefox 或 Safari 应用');
  const plist = join(appPath, 'Contents', 'Info.plist');
  const read = async (k: string) =>
    (await exec('/usr/libexec/PlistBuddy', ['-c', 'Print ' + k, plist])).stdout.trim();
  const bundle = await read('CFBundleIdentifier');
  const product = (Object.keys(products) as (keyof typeof products)[]).find(
    (k) => products[k].bundle === bundle,
  );
  if (!product) throw new Error('所选程序不是支持验证的浏览器');
  // An explicit local app binding verifies product metadata and executable name.
  // Bundle metadata is not a security attestation; OS launch policy remains in force.
  const binaryName = await read('CFBundleExecutable');
  if (binaryName !== products[product].binary) throw new Error('浏览器可执行文件与产品标识不匹配');
  const executable = join(appPath, 'Contents', 'MacOS', binaryName);
  await access(executable);
  const version = await read('CFBundleShortVersionString');
  if (product === 'chrome' && Number(version.split('.')[0]) < 120)
    throw new Error('Chrome 版本过低，请自行更新后重新选择');
  if (product === 'safari') driver = '/usr/bin/safaridriver';
  let driverVersion: string | undefined;
  if (driver) {
    await access(driver);
    driverVersion = (await exec(driver, ['--version'], { timeout: 5000 })).stdout.trim();
  }
  return {
    id: digest(executable).slice(0, 24),
    product,
    executable,
    version,
    driver,
    driverVersion,
  };
}
export async function discoverBrowsers() {
  const found: BrowserBinding[] = [];
  for (const p of Object.values(products)) {
    try {
      found.push(await inspectBrowser('/Applications/' + p.app));
    } catch {}
  }
  return found;
}
export async function validateBinding(b: BrowserBinding) {
  if (b.product === 'embedded') {
    if (b.id !== 'embedded' || !process.versions.electron)
      throw new Error('当前运行环境不支持内置浏览器');
    return { ...b, version: process.versions.chrome ?? b.version };
  }
  const current = await inspectBrowser(b.executable, b.driver);
  if (current.product !== b.product || current.id !== b.id)
    throw new Error('浏览器安装已变化，请重新选择');
  if (b.product === 'firefox' && !b.driver)
    throw new Error('缺少用户指定的本机 geckodriver；不会自动下载');
  return current;
}
