import type { BrowserBinding, BrowserCommand } from '../shared/types';
import { framePathOf } from '../core/browser-command';

export function commandBudget(timeoutMs = 15000): () => number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000)
    throw new Error('浏览器超时配置无效');
  const deadline = performance.now() + timeoutMs;
  return () => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw new Error('浏览器命令超时（含框架定位）');
    return remaining;
  };
}

export function assertBrowserOperations(
  binding: Pick<BrowserBinding, 'product'>,
  commands: BrowserCommand[],
) {
  for (const command of commands) {
    framePathOf(command);
    if (binding.product !== 'chrome' && command.operation === 'download')
      throw new Error('本机 Selenium 下载能力尚未验证');
    if (binding.product === 'safari' && command.operation === 'upload')
      throw new Error('Safari 上传需单独实测，当前禁止');
  }
}
