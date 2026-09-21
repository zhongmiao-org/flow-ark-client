import {
  WebContentsView,
  session,
  BrowserWindow,
  type DownloadItem,
  type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { EmbeddedPage } from '../adapters/embedded-page';
import type { BrowserCommand } from '../shared/types';
import { desktopViewportWidth } from '../shared/browser-viewport';
import {
  EMBEDDED_CLOSE_TIMEOUT_MS,
  EMBEDDED_FLUSH_TIMEOUT_MS,
  type EmbeddedStartReceipt,
  type EmbeddedCloseReceipt,
  type EmbeddedLostNotice,
  type EmbeddedCleanupFailure,
} from '../shared/embedded-lifecycle';
import { canonical, errorText } from '../shared/utils';
import type { RepairSelection } from '../shared/task-repair';
import { confirmWebContentsClosed } from './native-webcontents-close';
import type { EmbeddedReview } from '../shared/run-review';

type Bounds = { x: number; y: number; width: number; height: number };
type Operation = { stop: () => void };
type Capture = { host: BrowserWindow; attached: boolean };
type Download = {
  operation: Operation;
  owner: number;
  path: string;
  item?: DownloadItem;
  resolve: () => void;
  reject: (error: Error) => void;
};
type Resource = {
  id: string;
  documentRevision: number;
  pickDocument?: { requestId: string; revision: number };
  confirmedTarget?: RepairSelection;
  token?: string;
  phase: 'starting' | 'ready' | 'closing' | 'unknown' | 'closed';
  view?: WebContentsView;
  contents?: WebContents;
  page?: EmbeddedPage;
  starting?: Promise<void>;
  closing?: Promise<EmbeddedCloseReceipt>;
  operation?: Operation;
  capture?: Capture;
  download?: Download;
  viewportSize?: { width: number; height: number };
  presented?: boolean;
  lostNotified?: boolean;
};
const closedReceiptLimit = 1024;
const retiredTokenLimit = 10000;

export class EmbeddedBrowser {
  private resource?: Resource;
  private closed = new Map<string, EmbeddedCloseReceipt>();
  private retiredTokens = new Set<string>();
  private blocked?: string;
  private visible = false;
  private bounds: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  private websiteSession;

  constructor(
    private window: BrowserWindow,
    private lost: (notice: EmbeddedLostNotice) => void,
    private cleanupFailed?: (report: EmbeddedCleanupFailure) => void,
  ) {
    this.websiteSession = session.fromPartition('persist:flowark-web-panel');
    this.websiteSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    this.websiteSession.setPermissionCheckHandler(() => false);
    this.websiteSession.on('will-download', (event, item, contents) => {
      const resource = this.resource,
        request = resource?.download;
      if (
        this.blocked ||
        resource?.phase !== 'ready' ||
        !request ||
        request.item ||
        request.operation !== resource.operation ||
        contents?.id !== request.owner
      ) {
        event.preventDefault();
        return;
      }
      request.item = item;
      item.setSavePath(request.path);
      item.once('done', (_event, state) =>
        state === 'completed'
          ? request.resolve()
          : request.reject(new Error('下载未完成：' + state)),
      );
    });
    const layout = () => this.layout();
    window.on('resize', layout);
    window.on('show', layout);
    window.on('restore', layout);
    window.on('hide', layout);
    window.on('minimize', layout);
  }

  private block(error: string, resource?: Resource) {
    if (this.blocked) return;
    this.blocked = `${error}。内置网页回收未确认，执行已停止。请退出并重新打开应用后核对运行结果`;
    try {
      // Do not wait for Host: its stopping path may call close() on this resource.
      void Promise.resolve(
        this.cleanupFailed?.({
          token: resource?.token,
          resourceId: resource?.id,
          error: this.blocked,
        }),
      ).catch(() => {});
    } catch {
      // The local gate remains closed; workbench owns notification delivery failure.
    }
  }
  private permitted(url: string) {
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }
  private assertAvailable() {
    if (this.blocked) throw new Error(this.blocked);
    if (this.resource && ['closing', 'unknown'].includes(this.resource.phase))
      throw new Error('内置网页正在关闭，尚未确认资源回收');
  }
  private assertResource(resource: Resource, initializing = false) {
    this.assertAvailable();
    if (
      this.resource !== resource ||
      !resource.view ||
      !resource.contents ||
      resource.contents.isDestroyed() ||
      (resource.phase !== 'ready' && !(initializing && resource.phase === 'starting'))
    )
      throw new Error('网页会话已关闭或租约已失效');
  }
  private assertOperation(resource: Resource, operation: Operation) {
    this.assertResource(resource);
    if (resource.operation !== operation) throw new Error('网页操作已失效');
  }
  private notifyLost(resource: Resource, reason: string, destroyed: boolean) {
    if (resource.lostNotified) return;
    resource.lostNotified = true;
    try {
      void Promise.resolve(
        this.lost({ token: resource.token, resourceId: resource.id, reason, destroyed }),
      ).catch((error) => this.block('无法报告网页意外中断：' + errorText(error), resource));
    } catch (error) {
      this.block('无法报告网页意外中断：' + errorText(error), resource);
    }
  }
  private unexpectedLoss(resource: Resource, reason: string, destroyed: boolean) {
    if (resource.phase !== 'starting' && resource.phase !== 'ready') return;
    const closing = this.closeResource(resource);
    this.notifyLost(resource, reason, destroyed);
    void closing.catch((error) => this.block(errorText(error), resource));
  }
  private async ensure(token?: string): Promise<Resource> {
    this.assertAvailable();
    if (token && this.retiredTokens.has(token)) throw new Error('网页租约已结束，不能重新启用');
    if (token && this.resource?.token && token !== this.resource.token)
      throw new Error('网页会话已被另一个租约占用');
    if (token && !this.resource?.token && this.retiredTokens.size >= retiredTokenLimit) {
      this.block('网页租约记录已达到本次应用会话上限', this.resource);
      throw new Error(this.blocked);
    }
    let resource = this.resource;
    if (!resource) {
      resource = { id: randomUUID(), documentRevision: 0, token, phase: 'starting' };
      this.resource = resource;
      resource.starting = this.initialize(resource);
    } else if (token) {
      if (resource.phase !== 'starting' && resource.phase !== 'ready')
        throw new Error('网页会话正在关闭，不能借用此预览');
      // Bind before awaiting preview initialization so cancellation can find the resource.
      resource.token = token;
    }
    await resource.starting;
    this.assertResource(resource);
    return resource;
  }
  private async initialize(resource: Resource) {
    try {
      const view = new WebContentsView({
        webPreferences: {
          session: this.websiteSession,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
          safeDialogs: true,
          navigateOnDragDrop: false,
        },
      });
      resource.view = view;
      // Electron can clear view.webContents after native destruction. Keep the
      // exact generation's object for destruction evidence and late cleanup.
      const wc = view.webContents;
      resource.contents = wc;
      view.setBackgroundColor('#ffffff');
      view.setBounds({ x: 0, y: 0, width: 1000, height: 800 });
      view.setVisible(false);
      wc.on('will-navigate', (event, url) => {
        if (!this.permitted(url)) event.preventDefault();
      });
      wc.on('will-redirect', (event, url) => {
        if (!this.permitted(url)) event.preventDefault();
      });
      // Include iframe navigation, SPA navigation and same-URL reloads. URL alone
      // is not the identity of the document the user reviewed.
      wc.on('did-start-navigation', () => {
        resource.documentRevision++;
      });
      wc.on('did-navigate-in-page', () => {
        resource.documentRevision++;
      });
      wc.on('did-finish-load', () => {
        if (
          this.resource === resource &&
          resource.page &&
          ['starting', 'ready'].includes(resource.phase) &&
          !wc.isDestroyed()
        ) {
          resource.viewportSize = undefined;
          this.layoutViewport(resource, view.getBounds());
        }
      });
      wc.on('will-attach-webview', (event) => event.preventDefault());
      wc.setWindowOpenHandler(({ url }) => {
        if (
          this.resource === resource &&
          resource.phase === 'ready' &&
          !this.blocked &&
          this.permitted(url)
        )
          void wc.loadURL(url).catch(() => {});
        return { action: 'deny' };
      });
      wc.on('render-process-gone', (_event, details) =>
        this.unexpectedLoss(resource, '内置网页渲染进程意外结束：' + details.reason, false),
      );
      wc.once('destroyed', () => this.unexpectedLoss(resource, '内置网页意外关闭', true));
      this.window.contentView.addChildView(view);
      await wc.loadURL('about:blank');
      this.assertResource(resource, true);
      const page = new EmbeddedPage(wc, (mouse) => {
        if (mouse.globalX || mouse.globalY) {
          const window = this.window.getContentBounds(),
            bounds = view.getBounds();
          return {
            x: (mouse.globalX ?? 0) - window.x - bounds.x,
            y: (mouse.globalY ?? 0) - window.y - bounds.y,
          };
        }
        return { x: mouse.x, y: mouse.y };
      });
      resource.page = page;
      await page.initialize();
      this.assertResource(resource, true);
      resource.phase = 'ready';
      this.layoutViewport(resource, view.getBounds());
      this.layout();
    } catch (error) {
      await this.closeResource(resource);
      throw error;
    }
  }
  private layoutViewport(resource: Resource, bounds: Bounds) {
    const view = resource.view!;
    view.setBounds(bounds);
    const previous = resource.viewportSize;
    if (previous?.width === bounds.width && previous.height === bounds.height) return;
    resource.contents!.setZoomFactor(bounds.width / desktopViewportWidth);
    resource.viewportSize = { width: bounds.width, height: bounds.height };
  }
  private reconcilePresentation() {
    const presented =
      this.visible &&
      !this.window.isDestroyed() &&
      this.window.isVisible() &&
      !this.window.isMinimized();
    const resource = this.resource;
    if (resource?.page) {
      const previous = resource.presented;
      resource.presented = presented;
      if (!presented && previous !== false) {
        // cancel changes picker state before its first await. A status read must
        // not wait for an in-flight CDP request, or repeatedly queue its cleanup.
        void resource.page.picker.cancel().catch(() => {});
      }
    }
    return presented;
  }
  private layout() {
    const presented = this.reconcilePresentation();
    const resource = this.resource;
    if (
      !resource?.view ||
      !resource.page ||
      resource.phase !== 'ready' ||
      this.window.isDestroyed() ||
      resource.capture
    )
      return;
    const [width, height] = this.window.getContentSize();
    const x = Math.max(0, Math.min(this.bounds.x, width - 1)),
      y = Math.max(0, Math.min(this.bounds.y, height - 1));
    const w = Math.max(1, Math.min(this.bounds.width, width - x)),
      h = Math.max(1, Math.min(this.bounds.height, height - y));
    if (w > 1 && h > 1) this.layoutViewport(resource, { x, y, width: w, height: h });
    resource.view.setVisible(presented && w > 1 && h > 1);
  }
  viewport(bounds: Bounds) {
    this.bounds = bounds;
    this.layout();
    return true;
  }
  async visibility(visible: boolean) {
    if (visible) this.assertAvailable();
    this.visible = visible;
    if (visible) await this.ensure();
    this.layout();
    return this.status();
  }
  status() {
    // Native visibility can change without a hide/show event (for example around
    // a locked macOS session). Polls reconcile the actual window and page state.
    this.layout();
    const resource = this.resource,
      wc = resource?.contents;
    return {
      started: resource?.phase === 'ready' && !!wc && !wc.isDestroyed(),
      visible:
        this.visible &&
        !this.window.isDestroyed() &&
        this.window.isVisible() &&
        !this.window.isMinimized(),
      url: wc && !wc.isDestroyed() ? wc.getURL() : '',
      title: wc && !wc.isDestroyed() ? wc.getTitle() : '',
      ...(this.blocked ? { blocked: this.blocked } : {}),
    };
  }
  review(): EmbeddedReview {
    const resource = this.resource,
      wc = resource?.contents;
    const alive = !!wc && !wc.isDestroyed();
    const blocked =
      this.blocked ||
      (resource && !['ready', 'starting'].includes(resource.phase)
        ? '内置网页正在关闭或状态未知'
        : resource?.operation
          ? '内置网页正在执行操作'
          : undefined);
    return {
      ...(resource ? { resourceId: resource.id } : {}),
      documentRevision: resource?.documentRevision ?? 0,
      started: resource?.phase === 'ready' && alive,
      loading: resource?.phase === 'starting' || (alive && wc.isLoading()),
      url: alive ? wc.getURL() : '',
      title: alive ? wc.getTitle() : '',
      ...(blocked ? { blocked } : {}),
    };
  }
  async start(token: string): Promise<EmbeddedStartReceipt> {
    if (!token) throw new Error('缺少网页租约标识');
    const resource = await this.ensure(token);
    this.assertResource(resource);
    return { token, resourceId: resource.id, state: 'ready' };
  }
  async navigate(url: string) {
    const resource = await this.ensure();
    this.assertResource(resource);
    return this.perform({ operation: 'navigate', value: url, timeoutMs: 20000 }, resource.token);
  }
  async perform(command: BrowserCommand, token?: string) {
    this.assertAvailable();
    const resource = this.resource;
    if (
      !resource?.page ||
      resource.phase !== 'ready' ||
      token !== resource.token ||
      resource.operation
    )
      throw new Error('网页会话不可用、正被占用或租约已失效');
    this.assertResource(resource);
    let stop!: () => void;
    const stopped = new Promise<never>(
      (_, reject) => (stop = () => reject(new Error('网页会话已关闭'))),
    );
    const operation = { stop };
    resource.operation = operation;
    const page = resource.page;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const task = async () => {
      await page.picker.cancel();
      this.assertOperation(resource, operation);
      if (
        command.operation === 'screenshot' &&
        (!this.window.isVisible() || this.window.isMinimized() || !this.visible)
      )
        return this.backgroundCapture(resource, operation, command);
      if (command.operation !== 'download') return page.perform(command);
      let resolve!: () => void, reject!: (error: Error) => void;
      const done = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void done.catch(() => {});
      resource.download = {
        operation,
        owner: resource.contents!.id,
        path: String(command.value),
        resolve,
        reject,
      };
      await page.perform({ ...command, operation: 'click' });
      await done;
      this.assertOperation(resource, operation);
      return { saved: true };
    };
    try {
      const result = await Promise.race([
        task(),
        stopped,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('网页操作超时'));
          }, command.timeoutMs ?? 15000);
        }),
      ]);
      this.assertOperation(resource, operation);
      return result;
    } catch (error) {
      if (timedOut) await this.closeResource(resource);
      throw error;
    } finally {
      clearTimeout(timer);
      if (resource.download?.operation === operation) {
        try {
          resource.download.item?.cancel();
        } catch {}
        resource.download = undefined;
      }
      if (resource.operation === operation) resource.operation = undefined;
    }
  }
  private async backgroundCapture(
    resource: Resource,
    operation: Operation,
    command: BrowserCommand,
  ) {
    this.assertOperation(resource, operation);
    const view = resource.view!,
      page = resource.page!,
      bounds = view.getBounds();
    const host = new BrowserWindow({
      show: false,
      width: bounds.width,
      height: bounds.height,
      focusable: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const capture = { host, attached: false };
    resource.capture = capture;
    host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    host.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await host.loadURL('about:blank');
      this.assertOperation(resource, operation);
      this.window.contentView.removeChildView(view);
      host.contentView.addChildView(view);
      capture.attached = true;
      view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      view.setVisible(true);
      return await page.perform(command);
    } finally {
      if (resource.capture === capture) {
        // Closed/unknown generations are never reparented after a late capturePage result.
        if (
          this.resource === resource &&
          resource.phase === 'ready' &&
          !resource.contents!.isDestroyed()
        ) {
          try {
            if (capture.attached && !host.isDestroyed()) host.contentView.removeChildView(view);
            this.window.contentView.addChildView(view);
            capture.attached = false;
            view.setBounds(bounds);
          } catch (error) {
            await this.closeResource(resource);
            throw error;
          }
        }
      }
      try {
        if (!host.isDestroyed()) host.destroy();
      } catch (error) {
        await this.closeResource(resource);
        throw error;
      }
      if (resource.capture === capture && resource.phase === 'ready') {
        resource.capture = undefined;
        if (this.resource === resource) this.layout();
      }
    }
  }
  private async flush(warnings: string[]) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.websiteSession.cookies.flushStore(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('保存 Cookie 超时')),
            EMBEDDED_FLUSH_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      warnings.push('会话 Cookie 未确认保存：' + errorText(error));
    } finally {
      clearTimeout(timer);
    }
    try {
      this.websiteSession.flushStorageData();
    } catch (error) {
      warnings.push('会话存储刷新失败：' + errorText(error));
    }
  }
  private closeResource(resource: Resource): Promise<EmbeddedCloseReceipt> {
    if (resource.closing) return resource.closing;
    resource.phase = 'closing';
    if (resource.token) this.retiredTokens.add(resource.token);
    resource.operation?.stop();
    // Install the shared promise before native events can re-enter close().
    resource.closing = Promise.resolve().then(async (): Promise<EmbeddedCloseReceipt> => {
      const warnings: string[] = [];
      const cleanup = (label: string, task: () => void) => {
        try {
          task();
        } catch (error) {
          warnings.push(`${label}：${errorText(error)}`);
        }
      };
      try {
        cleanup('停止网页驱动失败', () => resource.page?.stop());
        cleanup('取消下载失败', () => resource.download?.reject(new Error('网页会话已关闭')));
        cleanup('停止下载失败', () => resource.download?.item?.cancel());
        const view = resource.view,
          contents = resource.contents,
          capture = resource.capture;
        if (view && !contents) throw new Error('缺少此网页资源的原生对象，无法确认销毁');
        const evidence = contents
          ? await confirmWebContentsClosed(
              contents,
              EMBEDDED_CLOSE_TIMEOUT_MS,
              () => {
                const parent = capture?.attached ? capture.host : this.window;
                if (view && !parent.isDestroyed()) parent.contentView.removeChildView(view);
              },
              () => {
                if (capture && !capture.host.isDestroyed()) capture.host.destroy();
              },
            )
          : { confirmed: true, warnings: [] };
        warnings.push(...evidence.warnings);
        if (!evidence.confirmed) throw new Error(evidence.error);
        if (capture && !capture.host.isDestroyed()) throw new Error('截图绘制窗口未确认销毁');
        await this.flush(warnings);
        const receipt: EmbeddedCloseReceipt = {
          state: 'closed',
          token: resource.token,
          resourceId: resource.id,
          ...(warnings.length ? { warnings } : {}),
        };
        resource.phase = 'closed';
        this.closed.set(resource.id, receipt);
        if (this.closed.size > closedReceiptLimit)
          this.closed.delete(this.closed.keys().next().value!);
        if (this.resource === resource) this.resource = undefined;
        return receipt;
      } catch (error) {
        resource.phase = 'unknown';
        const reason = [errorText(error), ...warnings].join('；');
        this.block(reason, resource);
        return { state: 'unknown', token: resource.token, resourceId: resource.id, error: reason };
      }
    });
    if (this.retiredTokens.size >= retiredTokenLimit)
      this.block('网页租约记录已达到本次应用会话上限', resource);
    return resource.closing;
  }
  async close(token?: string, resourceId?: string): Promise<EmbeddedCloseReceipt> {
    const resource = this.resource;
    if (
      resource &&
      (!token || token === resource.token) &&
      (!resourceId || resourceId === resource.id)
    )
      return this.closeResource(resource);
    if (!token && !resourceId) return { state: 'closed' };
    const receipt = resourceId
      ? this.closed.get(resourceId)
      : [...this.closed.values()].find((entry) => entry.token === token);
    if (receipt && (!token || receipt.token === token)) return receipt;
    return { state: 'unknown', token, resourceId, error: '没有匹配此网页租约与资源代际的销毁确认' };
  }
  async system(method: string, args: any) {
    switch (method) {
      case 'browser.embedded.pick.capture':
        return this.captureSelection(args.requestId);
      case 'browser.embedded.target.verify':
        return this.verifyTarget(args.selection);
      case 'browser.embedded.review':
        return this.review();
      case 'browser.embedded.pick.start':
      case 'browser.embedded.pick.validate': {
        this.assertAvailable();
        if (this.resource?.operation) throw new Error('网页正在执行操作，请稍后选取');
        const resource = await this.ensure();
        this.assertResource(resource);
        this.layout();
        if (resource.operation) throw new Error('网页正在执行操作，请稍后选取');
        if (!resource.presented) throw new Error('请先展开内置网页面板');
        if (!this.permitted(resource.contents!.getURL())) throw new Error('请先打开测试网页');
        const page = resource.page!;
        resource.confirmedTarget = undefined;
        if (method.endsWith('.start')) {
          resource.pickDocument = {
            requestId: args.requestId,
            revision: resource.documentRevision,
          };
          return page.picker.start(args.requestId);
        }
        let stop!: () => void;
        const stopped = new Promise<never>(
          (_, reject) => (stop = () => reject(new Error('网页会话已关闭'))),
        );
        const operation = { stop };
        resource.operation = operation;
        try {
          const result = await Promise.race([
            (async () => {
              await page.picker.cancel();
              this.assertOperation(resource, operation);
              return page.inspectTarget(args.selector, args.framePath);
            })(),
            stopped,
          ]);
          this.assertOperation(resource, operation);
          return result;
        } finally {
          if (resource.operation === operation) resource.operation = undefined;
        }
      }
      case 'browser.embedded.pick.status':
        this.layout();
        return (
          this.resource?.page?.picker.status(args.requestId) ?? {
            requestId: args.requestId,
            phase: 'cancelled',
          }
        );
      case 'browser.embedded.pick.cancel':
        if (
          this.resource &&
          (!args.requestId || this.resource.confirmedTarget?.requestId === args.requestId)
        )
          this.resource.confirmedTarget = undefined;
        await this.resource?.page?.picker.cancel(args.requestId).catch(() => {});
        return true;
      case 'browser.embedded.start':
        return this.start(args.token);
      case 'browser.embedded.perform':
        return this.perform(args.command, args.token);
      case 'browser.embedded.close':
        return this.close(args.token, args.resourceId);
      case 'browser.embedded.visibility':
        return this.visibility(args.visible);
      case 'browser.embedded.viewport':
        return this.viewport(args);
      case 'browser.embedded.status':
        return this.status();
      case 'browser.embedded.navigate':
        return this.navigate(args.url);
      default:
        throw new Error('未知网页方法');
    }
  }

  private async captureSelection(requestId: string): Promise<RepairSelection> {
    this.assertAvailable();
    this.layout();
    const resource = this.resource;
    const before = this.review();
    if (!resource || !before.started || before.loading || before.blocked)
      throw new Error('请打开已就绪的内置网页并重新选择目标');
    const confirmed = resource.confirmedTarget;
    if (confirmed?.requestId === requestId) {
      try {
        const verified = await this.verifyTarget(confirmed);
        if (resource.confirmedTarget !== confirmed) throw new Error('目标引用已取消或改变');
        return verified;
      } catch (error) {
        if (resource.confirmedTarget === confirmed) {
          resource.confirmedTarget = undefined;
          resource.pickDocument = undefined;
          void resource.page?.picker.cancel(requestId).catch(() => {});
        }
        throw error;
      }
    }
    if (!resource.presented) throw new Error('请展开内置网页并重新选择目标');
    const selected = resource.page!.picker.status(requestId);
    if (
      resource.pickDocument?.requestId !== requestId ||
      resource.pickDocument.revision !== before.documentRevision
    )
      throw new Error('选取后的网页已变化，请重新选取');
    if (selected.phase !== 'selected' || !selected.target)
      throw new Error('没有此请求的已选网页目标，请重新选取');
    const { selector, framePath, label, tag, inputType, structural } = selected.target;
    const captured = await this.verifyTarget({
      requestId,
      resourceId: resource.id,
      documentRevision: before.documentRevision,
      url: before.url,
      title: before.title,
      target: { selector, framePath, label, tag, inputType, structural },
    });
    if (!resource.presented || resource.page!.picker.status(requestId) !== selected)
      throw new Error('选取已取消或改变，请重新选取');
    resource.confirmedTarget = captured;
    return captured;
  }

  private async verifyTarget(selection: RepairSelection): Promise<RepairSelection> {
    this.assertAvailable();
    const resource = this.resource;
    const before = this.review();
    const identity = (value: typeof before) => ({
      resourceId: value.resourceId,
      documentRevision: value.documentRevision,
      url: value.url,
      title: value.title,
    });
    if (
      !resource ||
      !before.started ||
      before.loading ||
      before.blocked ||
      canonical(identity(before)) !== canonical(identity({ ...before, ...selection }))
    )
      throw new Error('网页已变化，请重新选取目标');
    let stop!: () => void;
    const stopped = new Promise<never>(
      (_, reject) => (stop = () => reject(new Error('网页会话已关闭'))),
    );
    const operation = { stop };
    resource.operation = operation;
    try {
      const inspected = await Promise.race([
        resource.page!.inspectTarget(selection.target.selector, selection.target.framePath, false),
        stopped,
      ]);
      this.assertOperation(resource, operation);
      const after = this.review();
      if (after.loading || canonical(identity(before)) !== canonical(identity(after)))
        throw new Error('网页已变化，请重新选取');
      const { selector, framePath, label, tag, inputType } = inspected;
      const target = {
        selector,
        framePath,
        label,
        tag,
        inputType,
        structural: inspected.structural || selection.target.structural,
      };
      if (canonical(target) !== canonical(selection.target))
        throw new Error('所选元素内容或结构已变化，请重新选取');
      return { ...selection, target };
    } finally {
      if (resource.operation === operation) resource.operation = undefined;
    }
  }
}
