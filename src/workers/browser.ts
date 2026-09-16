import { Rpc } from '../shared/rpc';
import type { BrowserDriver } from '../shared/types';
import { PlaywrightDriver } from '../adapters/playwright';
import { SeleniumDriver } from '../adapters/selenium';
import { validateBinding } from '../adapters/browsers';
let driver: BrowserDriver | undefined;
let busy = false;
const rpc = new Rpc(
  (m) => process.send?.(m),
  async (method, args) => {
    if (method === 'start') {
      if (driver) throw new Error('会话已启动');
      const binding = await validateBinding(args.binding);
      driver =
        binding.product === 'chrome'
          ? await PlaywrightDriver.start(binding, args.profile, args.headless)
          : await SeleniumDriver.start(binding);
      return { ready: true };
    }
    if (method === 'close') {
      await driver?.close();
      driver = undefined;
      return true;
    }
    if (method === 'perform') {
      if (!driver || busy) throw new Error('会话不可用或正被占用');
      busy = true;
      try {
        return await driver.perform(args);
      } finally {
        busy = false;
      }
    }
    throw new Error('未知会话方法');
  },
);
process.on('message', (m) => void rpc.receive(m as any));
async function stop() {
  rpc.close();
  try {
    await driver?.close();
  } finally {
    process.exit(0);
  }
}
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
