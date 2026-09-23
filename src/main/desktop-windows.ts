import { randomUUID } from 'node:crypto';
import {
  nativeWindowDiscovery,
  nativeSelectionPreview,
  selectionReasons,
  type DesktopWindowDiscovery,
  type DesktopSelectionPreview,
  type SelectionFailure,
  type SelectionIdentity,
} from '../shared/desktop-windows';
import { redactArtifactText } from '../shared/utils';
import { DesktopWindowSession } from './desktop-window-session';

export class DesktopWindows {
  private pending?: { requestId: string; result: Promise<DesktopWindowDiscovery> };
  private session?: DesktopWindowSession;
  constructor(
    private readonly executable: string,
    private readonly secrets: () => string[],
  ) {}

  list(requestId: string): Promise<DesktopWindowDiscovery> {
    if (this.pending?.requestId === requestId) return this.pending.result;
    this.stop();
    const result = this.read(requestId).finally(() => {
      if (this.pending?.result === result) this.pending = undefined;
    });
    this.pending = { requestId, result };
    return result;
  }
  release(observationId: string) {
    if (this.session?.id !== observationId) return false;
    this.stop();
    return true;
  }
  stop() {
    this.session?.stop();
    this.session = undefined;
    this.pending = undefined;
  }
  async preview(identity: SelectionIdentity): Promise<DesktopSelectionPreview> {
    const failed = (status: SelectionFailure): DesktopSelectionPreview => ({
      version: 1,
      ...identity,
      status,
      reason: selectionReasons[status],
    });
    const session = this.session;
    const nativeId = session?.windows.get(identity.windowId);
    if (
      !session ||
      session.id !== identity.observationId ||
      session.closed ||
      !nativeId ||
      Date.now() >= session.expiresAt
    )
      return failed('expired');
    try {
      const result = nativeSelectionPreview.parse(
        await session.call('preview', { windowId: nativeId }),
      );
      if (this.session !== session || session.closed || Date.now() >= session.expiresAt)
        return failed('expired');
      if (result.status !== 'ready') return failed(result.status);
      const masked = redactArtifactText(result.text, this.secrets());
      if (masked.truncated || masked.text.length > 20000) return failed('too-large');
      return {
        version: 1,
        ...identity,
        status: 'ready',
        text: masked.text,
        redacted: masked.text !== result.text,
        range: result.range,
        readAt: new Date().toISOString(),
        expiresAt: session.expiresAt,
      };
    } catch {
      session.stop();
      return failed(this.session === session ? 'unavailable' : 'expired');
    }
  }
  private async read(requestId: string): Promise<DesktopWindowDiscovery> {
    const base = {
      version: 2 as const,
      requestId,
      platform: process.platform === 'darwin' ? ('macos' as const) : ('unsupported' as const),
      accessibility: 'unknown' as const,
      windows: [],
      truncated: false,
      observedAt: new Date().toISOString(),
    };
    if (process.platform !== 'darwin') return { ...base, availability: 'unsupported' };
    const session = new DesktopWindowSession(this.executable);
    this.session = session;
    try {
      const result = nativeWindowDiscovery.parse(await session.call('list'));
      if (this.session !== session || session.closed) throw new Error('已替换窗口观察');
      if (result.availability !== 'available') session.stop();
      return {
        ...base,
        ...result,
        observedAt: new Date().toISOString(),
        windows: result.windows.map((window) => {
          const id = randomUUID();
          session.windows.set(id, window.id);
          return {
            ...window,
            title: redactArtifactText(window.title, this.secrets()).text.slice(0, 1024),
            id,
            application: 'TextEdit',
          };
        }),
        ...(result.availability === 'available'
          ? { observationId: session.id, expiresAt: session.expiresAt }
          : {}),
        ...(result.availability === 'unavailable'
          ? { reason: '文本编辑暂时无法提供窗口信息，请回到应用检查后重试。' }
          : {}),
      };
    } catch {
      session.stop();
      return { ...base, availability: 'unavailable', reason: '窗口信息读取未完成，请重新检查。' };
    }
  }
}
