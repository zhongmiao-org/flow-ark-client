import { execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { nativeWindowDiscovery, type DesktopWindowDiscovery } from '../shared/desktop-windows';
import { redactArtifactText } from '../shared/utils';

export class DesktopWindows {
  private pending?: Promise<DesktopWindowDiscovery>;
  private child?: ChildProcess;
  constructor(
    private readonly executable: string,
    private readonly secrets: () => string[],
  ) {}

  list(): Promise<DesktopWindowDiscovery> {
    if (this.pending) return this.pending;
    const operation = this.read().finally(() => {
      if (this.pending === operation) this.pending = undefined;
    });
    this.pending = operation;
    return operation;
  }

  stop() {
    this.child?.kill('SIGKILL');
  }

  private async read(): Promise<DesktopWindowDiscovery> {
    const base = {
      version: 1 as const,
      platform: process.platform === 'darwin' ? ('macos' as const) : ('unsupported' as const),
      accessibility: 'unknown' as const,
      windows: [],
      truncated: false,
      observedAt: new Date().toISOString(),
    };
    if (process.platform !== 'darwin') return { ...base, availability: 'unsupported' };
    try {
      const output = await new Promise<string>((resolve, reject) => {
        this.child = execFile(
          this.executable,
          [],
          {
            encoding: 'utf8',
            timeout: 8000,
            killSignal: 'SIGKILL',
            maxBuffer: 256 * 1024,
          },
          (error, stdout) => {
            this.child = undefined;
            if (error) reject(error);
            else resolve(stdout);
          },
        );
      });
      const result = nativeWindowDiscovery.parse(JSON.parse(output));
      return {
        ...base,
        ...result,
        observedAt: new Date().toISOString(),
        windows: result.windows.map((window) => ({
          ...window,
          title: redactArtifactText(window.title, this.secrets()).text.slice(0, 1024),
          id: randomUUID(),
          application: 'TextEdit',
        })),
        ...(result.availability === 'unavailable'
          ? { reason: '文本编辑暂时无法提供窗口信息，请回到应用检查后重试。' }
          : {}),
      };
    } catch {
      return {
        ...base,
        availability: 'unavailable',
        reason: '窗口信息读取未完成。请重新检查；若持续失败，请检查客户端安装是否完整。',
      };
    }
  }
}
