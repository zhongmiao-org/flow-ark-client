import { randomUUID } from 'node:crypto';
import {
  nativeWindowDiscovery,
  nativeSelectionPreview,
  nativeSelectionInspection,
  desktopSelectionInspection,
  selectionReasons,
  discoveryMetadataReasons,
  type DesktopWindowDiscovery,
  type DesktopSelectionPreview,
  type SelectionFailure,
  type SelectionIdentity,
  type SelectionReference,
} from '../shared/desktop-windows';
import { digest, redactArtifactText } from '../shared/utils';
import { DesktopWindowSession } from './desktop-window-session';
import {
  desktopBindingCheck,
  nativeDesktopWrite,
  type DesktopBinding,
  type DesktopWriteResult,
} from '../shared/desktop-run';

export class DesktopWindows {
  private pending?: { requestId: string; result: Promise<DesktopWindowDiscovery> };
  private session?: DesktopWindowSession;
  private captureEpoch = 0;
  private holdEpoch = 0;
  private lease?: {
    binding: DesktopBinding;
    session: DesktopWindowSession;
    original: string;
    fingerprint: string;
    runId?: string;
    used: boolean;
  };
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
    this.stopObservation();
    const result = this.read(requestId).finally(() => {
      if (this.pending?.result === result) this.pending = undefined;
    });
    this.pending = { requestId, result };
    return result;
  }
  release(observationId: string) {
    if (this.session?.id !== observationId) return false;
    this.stopObservation();
    return true;
  }
  stop() {
    this.holdEpoch++;
    this.stopObservation();
    this.lease?.session.stop();
  }
  private stopObservation() {
    this.captureEpoch++;
    this.selection = undefined;
    this.session?.stop();
    this.session = undefined;
    this.pending = undefined;
  }
  async hold(reference: SelectionReference, bindingId: string, replacementHash: string) {
    const ticket = ++this.holdEpoch;
    if (this.lease?.runId) throw new Error('已有运行占用应用窗口，请等待结束并核对结果');
    if (this.lease && !(await this.releaseBinding(this.lease.binding.bindingId)).confirmed)
      throw new Error('前次应用会话退出尚未确认，请稍后重新核对');
    if (this.lease) throw new Error('应用窗口已被运行认领，不能替换');
    const original = await this.resolve(reference);
    const checked = await this.inspect(reference);
    const saved = this.selection,
      session = this.session;
    const nativeId = session?.windows.get(reference.windowId);
    if (
      ticket !== this.holdEpoch ||
      !saved ||
      !session ||
      !nativeId ||
      !this.matches(reference, saved.value) ||
      checked.replacement !== 'available' ||
      checked.readback !== 'available'
    )
      throw new Error('绑定来源或修改条件已变化');
    const retained = nativeSelectionInspection.parse(
      await session.call('bind', {
        windowId: nativeId,
        bindingId,
        text: original.text,
        range: original.range,
      }),
    );
    if (
      ticket !== this.holdEpoch ||
      this.session !== session ||
      this.selection !== saved ||
      session.closed ||
      session.expiresAt <= Date.now() ||
      retained.status !== 'ready' ||
      digest({ text: retained.text, range: retained.range }) !== saved.fingerprint ||
      retained.replacement !== 'available' ||
      retained.readback !== 'available'
    )
      throw new Error('绑定期间窗口或选区已变化');
    const binding: DesktopBinding = {
      bindingId,
      expiresAt: session.expiresAt,
      windowTitle: session.titles.get(reference.windowId) ?? '文本编辑窗口',
      sourceHash: digest(original.text),
      replacementHash,
    };
    this.lease = {
      binding,
      session,
      original: original.text,
      fingerprint: saved.fingerprint,
      used: false,
    };
    this.captureEpoch++;
    this.selection = undefined;
    this.session = undefined;
    this.pending = undefined;
    return binding;
  }
  async verifyBinding(bindingId: string, runId?: string) {
    const lease = this.lease;
    if (
      !lease ||
      lease.binding.bindingId !== bindingId ||
      lease.runId !== runId ||
      lease.used ||
      lease.session.closed ||
      lease.binding.expiresAt <= Date.now()
    )
      throw new Error('应用窗口绑定已失效或已使用，请重新选择原选区');
    const result = nativeSelectionInspection.parse(
      await lease.session.call('verify', { bindingId }),
    );
    if (
      this.lease !== lease ||
      lease.runId !== runId ||
      lease.used ||
      lease.session.closed ||
      lease.binding.expiresAt <= Date.now() ||
      result.status !== 'ready' ||
      digest({ text: result.text, range: result.range }) !== lease.fingerprint ||
      result.text !== lease.original ||
      result.replacement !== 'available' ||
      result.readback !== 'available'
    )
      throw new Error('原窗口、选区或修改能力已变化，请重新核对');
    return desktopBindingCheck.parse({ ...lease.binding, original: lease.original });
  }
  async claimBinding(bindingId: string, runId: string) {
    const lease = this.lease;
    await this.verifyBinding(bindingId);
    if (!lease || this.lease !== lease || lease.runId) throw new Error('窗口绑定已被占用');
    lease.runId = runId;
    return true;
  }
  async releaseBinding(bindingId: string, runId?: string) {
    const lease = this.lease;
    if (!lease || lease.binding.bindingId !== bindingId || (lease.runId && lease.runId !== runId))
      return { confirmed: true, released: false };
    lease.used = true;
    const confirmed = await lease.session.stopConfirmed();
    if (confirmed && this.lease === lease) this.lease = undefined;
    return { confirmed, released: confirmed };
  }
  async writeBinding(bindingId: string, runId: string, text: string): Promise<DesktopWriteResult> {
    let dispatched = false;
    try {
      const checked = await this.verifyBinding(bindingId, runId);
      const lease = this.lease;
      if (
        !lease ||
        lease.binding.bindingId !== bindingId ||
        lease.runId !== runId ||
        lease.used ||
        digest(text) !== lease.binding.replacementHash ||
        !text.trim() ||
        text.length > 20000
      )
        throw new Error('写入内容或权限不匹配');
      lease.used = true;
      dispatched = true;
      const reply = nativeDesktopWrite.parse(
        await lease.session.call('replace', { bindingId, replacement: text }),
      );
      if (reply.status === 'verified' && reply.readback === text)
        return {
          status: 'verified',
          message: '已替换原选区并按范围回读一致；文档尚未自动保存。',
          original: checked.original,
          readback: reply.readback,
        };
      if (reply.status === 'not-written')
        return { status: 'not-written', message: '写入前目标或能力发生变化，本次未发送文字修改。' };
      return {
        status: 'unknown',
        message: '可能已修改原选区，但回读未能确认。请人工核对，未自动重试。',
      };
    } catch {
      return dispatched
        ? { status: 'unknown', message: '修改请求已发出，但结果未能确认。请人工核对，未自动重试。' }
        : {
            status: 'not-written',
            message: '窗口、原选区或单次权限未通过核对，本次未发送文字修改。',
          };
    }
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
      const { metadataIssue, ...result } = nativeWindowDiscovery.parse(await session.call('list'));
      if (this.session !== session || session.closed) throw new Error('已替换窗口观察');
      if (result.availability !== 'available') session.stop();
      return {
        ...base,
        ...result,
        observedAt: new Date().toISOString(),
        windows: result.windows.map((window) => {
          const id = randomUUID();
          session.windows.set(id, window.id);
          session.titles.set(
            id,
            redactArtifactText(window.title, this.secrets()).text.slice(0, 1024),
          );
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
        ...(result.availability === 'available' && metadataIssue
          ? { reason: discoveryMetadataReasons[metadataIssue] }
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
