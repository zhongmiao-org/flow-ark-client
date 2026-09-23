import { randomUUID } from 'node:crypto';
import {
  nativeWindowDiscovery,
  nativeSelectionPreview,
  nativeSelectionInspection,
  desktopSelectionInspection,
  selectionReasons,
  type DesktopWindowDiscovery,
  type DesktopSelectionPreview,
  type SelectionFailure,
  type SelectionIdentity,
  type SelectionReference,
} from '../shared/desktop-windows';
import { digest, redactArtifactText } from '../shared/utils';
import { DesktopWindowSession } from './desktop-window-session';

export class DesktopWindows {
  private pending?: { requestId: string; result: Promise<DesktopWindowDiscovery> };
  private session?: DesktopWindowSession;
  private captureEpoch = 0;
  private selection?: {
    value: Extract<DesktopSelectionPreview, { status: 'ready' }>;
    fingerprint: string;
  };

  constructor(
    private readonly executable: string,
    private readonly secrets: () => string[],
    private readonly invalidated: (observationId: string) => void = () => {},
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
    this.captureEpoch++;
    this.selection = undefined;
    this.session?.stop();
    this.session = undefined;
    this.pending = undefined;
  }
  clear(reference: SelectionReference) {
    if (!this.selection || !this.matches(reference, this.selection.value)) return false;
    this.captureEpoch++;
    this.selection = undefined;
    this.invalidated(reference.observationId);
    return true;
  }
  private matches(a: SelectionReference, b: SelectionReference) {
    return (
      a.observationId === b.observationId &&
      a.windowId === b.windowId &&
      a.previewId === b.previewId
    );
  }
  async preview(identity: SelectionIdentity): Promise<DesktopSelectionPreview> {
    const ticket = ++this.captureEpoch;
    this.selection = undefined;
    this.invalidated(identity.observationId);
    const captured = await this.capture(identity);
    if (ticket !== this.captureEpoch)
      return { version: 1, ...identity, status: 'expired', reason: selectionReasons.expired };
    if (captured.value.status === 'ready')
      this.selection = { value: captured.value, fingerprint: captured.fingerprint! };
    return captured.value;
  }
  async resolve(reference: SelectionReference) {
    const saved = this.selection;
    if (!saved || !this.matches(reference, saved.value))
      throw new Error('原段落预览已失效，请重新读取并核对');
    if (saved.value.redacted) throw new Error('选区包含已遮盖的信息，请缩小选区后重新核对');
    const captured = await this.capture(reference);
    if (
      this.selection !== saved ||
      captured.value.status !== 'ready' ||
      captured.fingerprint !== saved.fingerprint ||
      captured.value.text !== saved.value.text ||
      captured.value.redacted
    ) {
      this.clear(reference);
      throw new Error('窗口或选区已变化，请重新读取后核对');
    }
    return saved.value;
  }
  async inspect(reference: SelectionReference) {
    await this.resolve(reference);
    const saved = this.selection,
      session = this.session;
    const nativeId = session?.windows.get(reference.windowId);
    if (
      !saved ||
      !this.matches(reference, saved.value) ||
      saved.value.redacted ||
      !session ||
      !nativeId ||
      session.closed ||
      session.expiresAt <= Date.now()
    )
      throw new Error('原段落预览已失效，请重新读取');
    try {
      const result = nativeSelectionInspection.parse(
        await session.call('inspect', { windowId: nativeId }),
      );
      if (
        this.selection !== saved ||
        this.session !== session ||
        session.closed ||
        session.expiresAt <= Date.now() ||
        result.status !== 'ready' ||
        digest({ text: result.text, range: result.range }) !== saved.fingerprint ||
        redactArtifactText(result.text, this.secrets()).text !== saved.value.text
      )
        throw new Error('窗口或选区已变化');
      return desktopSelectionInspection.parse({
        version: 1,
        ...reference,
        checkedAt: new Date().toISOString(),
        expiresAt: saved.value.expiresAt,
        replacement: result.replacement,
        readback: result.readback,
      });
    } catch {
      this.clear(reference);
      throw new Error('未能核对原窗口与选区，请重新读取后生成候选');
    }
  }
  private async capture(
    identity: SelectionIdentity,
  ): Promise<{ value: DesktopSelectionPreview; fingerprint?: string }> {
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
      return { value: failed('expired') };
    try {
      const result = nativeSelectionPreview.parse(
        await session.call('preview', { windowId: nativeId }),
      );
      if (this.session !== session || session.closed || Date.now() >= session.expiresAt)
        return { value: failed('expired') };
      if (result.status !== 'ready') return { value: failed(result.status) };
      const masked = redactArtifactText(result.text, this.secrets());
      if (masked.truncated || masked.text.length > 20000) return { value: failed('too-large') };
      return {
        fingerprint: digest({ text: result.text, range: result.range }),
        value: {
          version: 1,
          previewId: randomUUID(),
          ...identity,
          status: 'ready',
          text: masked.text,
          redacted: masked.text !== result.text,
          range: result.range,
          readAt: new Date().toISOString(),
          expiresAt: session.expiresAt,
        },
      };
    } catch {
      session.stop();
      return { value: failed(this.session === session ? 'unavailable' : 'expired') };
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
    const session = new DesktopWindowSession(this.executable, () => {
      if (this.session === session) {
        this.captureEpoch++;
        this.selection = undefined;
      }
      this.invalidated(session.id);
    });
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
