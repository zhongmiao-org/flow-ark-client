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
  binding: Pick<BrowserBinding, 'product'> & Partial<Pick<BrowserBinding, 'version'>>,
  commands: Pick<BrowserCommand, 'operation' | 'framePath' | 'version'>[],
) {
  for (const command of commands) {
    framePathOf(command);
    if (command.version === 12 && !['chrome', 'embedded'].includes(binding.product))
      throw Error('此浏览器尚未实现区域滚动，请选择内置浏览器或 Chrome；不会切换驱动。');
    if (command.version === 8 && !['chrome', 'embedded'].includes(binding.product))
      throw Error(
        '此浏览器尚未实现变量目标的固定元素核对，请选择内置浏览器或 Chrome；不会改用旧节点执行。',
      );
    if (command.operation === 'collect' && !['chrome', 'embedded'].includes(binding.product))
      throw Error(
        '此浏览器尚不能核对关联采集的文档代次，请明确选择内置浏览器或 Chrome；不会切换驱动或采用独立读取。',
      );
    if (
      process.platform === 'darwin' &&
      binding.product === 'chrome' &&
      binding.version === '153.0.8010.48' &&
      command.operation === 'download'
    )
      throw new Error(
        'Chrome 153.0.8010.48 在本机存在原生下载恢复崩溃，当前阻止自动下载；其他操作可单独调试。不会点击或重试。',
      );
    if (!['chrome', 'embedded'].includes(binding.product) && command.operation === 'download')
      throw new Error('本机 Selenium 下载能力尚未验证');
    if (binding.product === 'safari' && command.operation === 'upload')
      throw new Error('Safari 上传需单独实测，当前禁止');
  }
}
