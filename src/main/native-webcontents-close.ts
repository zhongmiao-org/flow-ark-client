type NativeContents = {
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
  close(options: { waitForBeforeUnload: false }): void;
};
type CloseEvidence = { confirmed: boolean; warnings: string[]; error?: string };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Electron-independent confirmation logic; a returned close() is not destruction evidence. */
export async function confirmWebContentsClosed(
  contents: NativeContents,
  timeoutMs: number,
  detach: () => void = () => {},
  afterClose: () => void = () => {},
): Promise<CloseEvidence> {
  const warnings: string[] = [];
  let observed = contents.isDestroyed();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notify!: () => void;
  const destroyed = new Promise<void>((resolve) => (notify = resolve));
  const onDestroyed = () => {
    observed = true;
    notify();
  };
  if (!observed) contents.once('destroyed', onDestroyed);
  const cleanup = (label: string, task: () => void) => {
    try {
      task();
    } catch (error) {
      warnings.push(`${label}：${message(error)}`);
    }
  };
  try {
    cleanup('移除网页视图失败', detach);
    cleanup('关闭原生网页失败', () => {
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
    });
    cleanup('清理截图绘制窗口失败', afterClose);
    if (!observed && !contents.isDestroyed()) {
      await Promise.race([
        destroyed,
        new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs))),
      ]);
    }
    if (observed || contents.isDestroyed()) return { confirmed: true, warnings };
    return {
      confirmed: false,
      warnings,
      error: '未取得原生网页销毁确认' + (warnings.length ? `；${warnings.join('；')}` : ''),
    };
  } finally {
    clearTimeout(timer);
    contents.removeListener('destroyed', onDestroyed);
  }
}
