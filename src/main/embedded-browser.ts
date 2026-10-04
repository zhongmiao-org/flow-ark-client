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
import { pageIdentity, sameWebPage, type WebPageIdentity } from '../shared/task-web-target';
import { observationPan, type ObservationPan } from '../shared/browser-observation';

type Bounds = { x: number; y: number; width: number; height: number };
type Operation = { stop: (reason?: Error) => void; pickRequestId?: string };
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
  pendingViewport?: Bounds;
  observationMode?: 'overview' | 'readable';
  observation?: Promise<void>;
  observationRevision?: number;
  observationPercentage?: number;
  observationError?: string;
  observationFeedback?: string;
  panning?: boolean;
  panRequest?: { args: ObservationPan; observationRevision?: number };
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
    private requestPan?: (request: ObservationPan) => Promise<unknown>,
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
      wc.on('before-input-event', (event, input) => {
        if (
          process.platform !== 'darwin' ||
          !this.requestPan ||
          this.resource !== resource ||
          resource.observationMode !== 'readable' ||
          !input.alt ||
          !input.meta ||
          input.control ||
          input.shift ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(input.key)
        )
          return;
        event.preventDefault();
        if (input.type !== 'keyDown' || input.isAutoRepeat || resource.panRequest) return;
        const request = {
          args: {
            resourceId: resource.id,
            documentRevision: resource.documentRevision,
            direction: input.key.slice(5).toLowerCase() as ObservationPan['direction'],
          },
          observationRevision: resource.observationRevision,
        };
        resource.observationFeedback = undefined;
        resource.panRequest = request;
        void this.requestPan(request.args)
          .catch((error) => {
            if (
              this.resource === resource &&
              resource.phase === 'ready' &&
              resource.documentRevision === request.args.documentRevision &&
              resource.observationRevision === request.observationRevision
            )
              resource.observationFeedback = errorText(error);
          })
          .finally(() => {
            if (resource.panRequest === request) resource.panRequest = undefined;
          });
      });
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
          resource.observationMode = 'overview';
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
    // Keep the input geometry stable until the current browser action ends.
    if (resource.operation || resource.panning) {
      resource.pendingViewport = bounds;
      return;
    }
    resource.pendingViewport = undefined;
    const view = resource.view!;
    view.setBounds(bounds);
    const previous = resource.viewportSize;
    if (previous?.width === bounds.width && previous.height === bounds.height) return;
    resource.contents!.setZoomFactor(bounds.width / desktopViewportWidth);
    resource.viewportSize = { width: bounds.width, height: bounds.height };
    void this.updateObservation(resource, resource.observationMode ?? 'overview').catch(() => {});
  }
  private updateObservation(resource: Resource, mode: 'overview' | 'readable') {
    const previous = resource.observation;
    const revision = (resource.observationRevision ?? 0) + 1;
    resource.observationRevision = revision;
    resource.observationMode = mode;
    resource.observationPercentage = undefined;
    resource.observationError = undefined;
    resource.observationFeedback = undefined;
    resource.confirmedTarget = undefined;
    resource.pickDocument = undefined;
    const pending = (async () => {
      // A new explicit choice can recover from a prior scale failure. Cleanup
      // for this choice still has to succeed before changing the native view.
      await previous?.catch(() => {});
      this.assertResource(resource);
      if (resource.observationRevision !== revision) return;
      await resource.page!.picker.cancel();
      this.assertResource(resource);
      if (resource.observationRevision !== revision) return;
      const scale = mode === 'readable' ? 1 / resource.contents!.getZoomFactor() : 1;
      const percentage = await resource.page!.observationScale(scale);
      this.assertResource(resource);
      if (resource.observationRevision === revision) resource.observationPercentage = percentage;
    })()
      .catch((error) => {
        if (resource.observationRevision === revision) resource.observationError = errorText(error);
        throw error;
      })
      .finally(() => {
        if (resource.observation === pending) resource.observation = undefined;
      });
    resource.observation = pending;
    return pending;
  }
  private async observation(mode: 'overview' | 'readable') {
    this.assertAvailable();
    const resource = this.resource;
    if (!resource) throw new Error('请先打开网页');
    this.assertResource(resource);
    this.layout();
    if (resource.operation || resource.capture || resource.observation)
      throw new Error('网页正在执行操作或调整显示，请稍后重试');
    if (!resource.presented || resource.contents!.isLoading())
      throw new Error('请先展开并等待网页加载完成');
    if (!this.permitted(resource.contents!.getURL())) throw new Error('请先打开网页');
    await this.updateObservation(resource, mode);
    return this.status();
  }
  private async pan(raw: unknown) {
    const args = observationPan.parse(raw);
    this.assertAvailable();
    const resource = this.resource;
    if (!resource) throw new Error('请先打开网页');
    this.assertResource(resource);
    const request = resource.panRequest;
    if (
      !request ||
      canonical(request.args) !== canonical(args) ||
      resource.id !== args.resourceId ||
      resource.documentRevision !== args.documentRevision ||
      resource.observationRevision !== request.observationRevision
    )
      throw new Error('网页查看已改变，请重新操作');
    if (
      resource.operation ||
      resource.capture ||
      resource.observation ||
      !resource.presented ||
      resource.contents!.isLoading() ||
      !this.permitted(resource.contents!.getURL()) ||
      resource.observationMode !== 'readable'
    )
      throw new Error('网页正在执行操作或调整显示，请稍后重试');
    if (resource.observationError) throw new Error('请先重新选择查看模式');
    const revision = (resource.observationRevision ?? 0) + 1;
    resource.observationRevision = revision;
    resource.panning = true;
    resource.confirmedTarget = undefined;
    resource.pickDocument = undefined;
    const pending = (async () => {
      await resource.page!.picker.cancel();
      this.assertResource(resource);
      if (
        resource.observationRevision !== revision ||
        !resource.presented ||
        resource.documentRevision !== args.documentRevision ||
        resource.contents!.isLoading()
      )
        throw new Error('网页查看已改变，请重新操作');
      const percentage = await resource.page!.panObservation(args.direction);
      this.assertResource(resource);
      if (resource.documentRevision !== args.documentRevision)
        throw new Error('网页已变化，请重新选择查看模式');
      if (resource.observationRevision === revision) resource.observationPercentage = percentage;
    })()
      .catch((error) => {
        if (resource.observationRevision === revision) resource.observationError = errorText(error);
        throw error;
      })
      .finally(() => {
        if (resource.observation === pending) resource.observation = undefined;
        resource.panning = false;
        if (resource.phase === 'ready' && resource.pendingViewport) this.layout();
      });
    resource.observation = pending;
    await pending;
    return this.status();
  }
  private finishOperation(resource: Resource, operation: Operation) {
    if (resource.operation !== operation) return;
    resource.operation = undefined;
    if (resource.phase === 'ready' && resource.pendingViewport) this.layout();
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
      loading: resource?.phase === 'starting' || (!!wc && !wc.isDestroyed() && wc.isLoading()),
      observation: {
        mode: resource?.observationMode ?? 'overview',
        busy: !!resource?.observation,
        percentage: resource?.observationPercentage,
        error: resource?.observationError ?? resource?.observationFeedback,
      },
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
          : resource?.observation
            ? '内置网页正在调整显示'
            : resource?.observationError
              ? '网页显示比例尚未确认，请重新选择查看模式'
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
  async perform(command: BrowserCommand, token?: string, expected?: WebPageIdentity) {
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
    const selected = () => pageIdentity({ ...this.review(), blocked: undefined });
    const verifySelected = () => {
      if (expected && !sameWebPage(expected, selected()))
        throw new Error('所选网页已变化，请重新选择目标');
    };
    verifySelected();
    if (
      expected &&
      (command.operation === 'navigate'
        ? command.value !== expected.url
        : !['read', 'wait'].includes(command.operation))
    )
      throw new Error('操作超出所选网页的只读范围');
    let stop!: () => void;
    const stopped = new Promise<never>(
      (_, reject) => (stop = () => reject(new Error('网页会话已关闭'))),
    );
    const operation = { stop };
    resource.operation = operation;
    const page = resource.page;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    let idle: (() => void) | undefined;
    let selectedNavigations = 0;
    let unexpectedNavigation = false;
    const navigation = (
      _event: Electron.Event,
      url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (mainFrame) {
        selectedNavigations++;
        unexpectedNavigation ||= url !== expected?.url || selectedNavigations > 1;
      }
    };
    if (expected && command.operation === 'navigate')
      resource.contents!.on('did-start-navigation', navigation);
    const task = async () => {
      await resource.observation;
      this.assertOperation(resource, operation);
      if (resource.observationError) throw new Error(resource.observationError);
      await page.picker.cancel();
      this.assertOperation(resource, operation);
      verifySelected();
      if (
        command.operation === 'screenshot' &&
        (!this.window.isVisible() || this.window.isMinimized() || !this.visible)
      )
        return this.backgroundCapture(resource, operation, command);
      if (command.operation !== 'download') {
        const result = await page.perform(command);
        // loadURL resolves at did-finish-load, before isLoading necessarily clears.
        // Keep the selected navigation within its operation/deadline until idle.
        if (expected && command.operation === 'navigate' && resource.contents!.isLoading())
          await new Promise<void>((resolve) => {
            idle = resolve;
            resource.contents!.once('did-stop-loading', idle);
          });
        return result;
      }
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
      if (expected) {
        if (command.operation === 'navigate' && (unexpectedNavigation || selectedNavigations !== 1))
          throw new Error('所选网页发生额外导航，结果未采用');
        const after = selected();
        if (
          after.resourceId !== expected.resourceId ||
          after.url !== expected.url ||
          (command.operation !== 'navigate' && !sameWebPage(after, expected))
        )
          throw new Error('所选网页在操作期间改变，结果未采用');
        return { result, page: after };
      }
      return result;
    } catch (error) {
      if (timedOut) await this.closeResource(resource);
      throw error;
    } finally {
      clearTimeout(timer);
      resource.contents!.removeListener('did-start-navigation', navigation);
      if (idle) resource.contents!.removeListener('did-stop-loading', idle);
      if (resource.download?.operation === operation) {
        try {
          resource.download.item?.cancel();
        } catch {}
        resource.download = undefined;
      }
      this.finishOperation(resource, operation);
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
        let stop!: (reason?: Error) => void;
        let stoppedReason: Error | undefined;
        const stopped = new Promise<never>((_, reject) => {
          stop = (reason) => {
            stoppedReason = reason ?? new Error('网页会话已关闭');
            reject(stoppedReason);
          };
        });
        const operation: Operation = {
          stop,
          pickRequestId: method.endsWith('.start') ? args.requestId : undefined,
        };
        resource.operation = operation;
        try {
          const result = await Promise.race([
            (async () => {
              // Opening the panel may still be applying its native scale. Own
              // the operation while waiting so another resize is deferred.
              await resource.observation;
              if (stoppedReason) throw stoppedReason;
              this.assertOperation(resource, operation);
              if (resource.observationError) throw new Error(resource.observationError);
              if (!resource.presented || resource.contents!.isLoading())
                throw new Error('请先展开并等待网页加载完成');
              if (!this.permitted(resource.contents!.getURL())) throw new Error('请先打开测试网页');
              if (method.endsWith('.start')) {
                resource.pickDocument = {
                  requestId: args.requestId,
                  revision: resource.documentRevision,
                };
                return page.picker.start(args.requestId);
              }
              await page.picker.cancel();
              this.assertOperation(resource, operation);
              return page.inspectTarget(args.selector, args.framePath);
            })(),
            stopped,
          ]);
          this.assertOperation(resource, operation);
          return result;
        } finally {
          this.finishOperation(resource, operation);
        }
      }
      case 'browser.embedded.pick.confirm': {
        this.assertAvailable();
        const resource = this.resource;
        if (resource?.operation) throw new Error('网页正在执行操作，请稍后选取');
        const selected = resource?.page?.picker.status(args.requestId);
        if (!resource || selected?.phase !== 'selected' || !selected.target)
          throw new Error('没有此请求的已选网页目标，请重新选取');
        const confirmed = await this.captureSelection(args.requestId);
        if (this.resource !== resource || resource.page!.picker.status(args.requestId) !== selected)
          throw new Error('选取已取消或改变，请重新选取');
        return { ...selected.target, ...confirmed.target };
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
          this.resource?.operation?.pickRequestId &&
          (!args.requestId || this.resource.operation.pickRequestId === args.requestId)
        )
          this.resource.operation.stop(new Error('选取已取消'));
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
      case 'browser.embedded.perform.selected':
        return this.perform(
          args.command,
          args.token,
          pageIdentity({ ...args.expected, started: true, loading: false }),
        );
      case 'browser.embedded.close':
        return this.close(args.token, args.resourceId);
      case 'browser.embedded.visibility':
        return this.visibility(args.visible);
      case 'browser.embedded.viewport':
        return this.viewport(args);
      case 'browser.embedded.status':
        return this.status();
      case 'browser.embedded.observation':
        return this.observation(args.mode);
      case 'browser.embedded.pan':
        return this.pan(args);
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
      this.finishOperation(resource, operation);
    }
  }
}
