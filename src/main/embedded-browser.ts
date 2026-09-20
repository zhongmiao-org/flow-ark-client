import { WebContentsView, session, BrowserWindow, type DownloadItem } from 'electron';
import { EmbeddedPage } from '../adapters/embedded-page';
import type { BrowserCommand } from '../shared/types';
import { desktopViewportWidth } from '../shared/browser-viewport';
type Bounds = { x: number; y: number; width: number; height: number };
export class EmbeddedBrowser {
  private view?: WebContentsView;
  private page?: EmbeddedPage;
  private starting?: Promise<void>;
  private token?: string;
  private visible = false;
  private bounds: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  private busy = false;
  private viewportSize?: { view: WebContentsView; width: number; height: number };
  private capture?: { host: BrowserWindow; view: WebContentsView };
  private stopOperation?: () => void;
  private download?: {
    owner: number;
    path: string;
    item?: DownloadItem;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  private websiteSession;
  constructor(
    private window: BrowserWindow,
    private lost: (token?: string) => void,
  ) {
    this.websiteSession = session.fromPartition('persist:flowark-web-panel');
    this.websiteSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    this.websiteSession.setPermissionCheckHandler(() => false);
    this.websiteSession.on('will-download', (event, item, contents) => {
      const request = this.download;
      if (!request || request.item || contents?.id !== request.owner) {
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
    window.on('resize', () => this.layout());
    window.on('show', () => this.layout());
    window.on('restore', () => this.layout());
    window.on('hide', () => this.layout());
    window.on('minimize', () => this.layout());
    window.on('hide', () => {
      void this.page?.picker.cancel();
    });
    window.on('minimize', () => {
      void this.page?.picker.cancel();
    });
  }
  private permitted(url: string) {
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }
  private async ensure() {
    if (this.starting) return this.starting;
    if (this.view && !this.view.webContents.isDestroyed()) return;
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
    this.view = view;
    view.setBackgroundColor('#ffffff');
    view.setBounds({ x: 0, y: 0, width: 1000, height: 800 });
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const wc = view.webContents;
    wc.on('will-navigate', (event, url) => {
      if (!this.permitted(url)) event.preventDefault();
    });
    wc.on('will-redirect', (event, url) => {
      if (!this.permitted(url)) event.preventDefault();
    });
    // Page zoom is origin-scoped and must be restored on a new document. Restore it before
    // navigation completion is observed by the execution driver.
    wc.on('did-finish-load', () => {
      if (this.view === view && this.page) {
        this.viewportSize = undefined;
        this.layoutViewport(view, view.getBounds());
      }
    });
    wc.on('will-attach-webview', (event) => event.preventDefault());
    wc.setWindowOpenHandler(({ url }) => {
      if (this.permitted(url)) void wc.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    const gone = () => {
      if (this.view !== view) return;
      const token = this.token;
      void this.close().finally(() => this.lost(token));
    };
    wc.on('render-process-gone', gone);
    wc.once('destroyed', gone);
    const start = (async () => {
      await wc.loadURL('about:blank');
      const page = new EmbeddedPage(wc, (mouse) => {
        // Native input inside an OOPIF is frame-local. Screen coordinates stay
        // stable, so convert to view-local input before applying the page zoom.
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
      this.page = page;
      await page.initialize();
      if (this.view !== view) throw new Error('网页会话已关闭');
      this.layoutViewport(view, view.getBounds());
      this.layout();
    })();
    this.starting = start;
    try {
      await start;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (this.starting === start) this.starting = undefined;
    }
  }
  private layoutViewport(view: WebContentsView, bounds: Bounds) {
    view.setBounds(bounds);
    const previous = this.viewportSize;
    if (
      previous?.view === view &&
      previous.width === bounds.width &&
      previous.height === bounds.height
    )
      return;
    // Native page zoom keeps layout at desktop width while Chromium handles
    // painting, input routing, and cross-process frames with the same transform.
    view.webContents.setZoomFactor(bounds.width / desktopViewportWidth);
    this.viewportSize = { view, width: bounds.width, height: bounds.height };
  }
  private layout() {
    // A cancelled capture can still be settling after a replacement page starts.
    // Only the page actually reparented to the paint host must defer its layout.
    if (!this.view || !this.page || this.window.isDestroyed() || this.capture?.view === this.view)
      return;
    const [width, height] = this.window.getContentSize();
    const x = Math.max(0, Math.min(this.bounds.x, width - 1)),
      y = Math.max(0, Math.min(this.bounds.y, height - 1));
    const w = Math.max(1, Math.min(this.bounds.width, width - x)),
      h = Math.max(1, Math.min(this.bounds.height, height - y));
    // Keep the hidden page usable for automation at its last viewport size.
    if (w > 1 && h > 1) this.layoutViewport(this.view, { x, y, width: w, height: h });
    this.view.setVisible(
      this.visible && w > 1 && h > 1 && this.window.isVisible() && !this.window.isMinimized(),
    );
  }
  viewport(bounds: Bounds) {
    this.bounds = bounds;
    this.layout();
    return true;
  }
  async visibility(visible: boolean) {
    this.visible = visible;
    if (!visible) await this.page?.picker.cancel();
    if (visible) await this.ensure();
    this.layout();
    return this.status();
  }
  status() {
    const wc = this.view?.webContents;
    return {
      started: !!wc && !wc.isDestroyed(),
      visible: this.visible && this.window.isVisible() && !this.window.isMinimized(),
      url: wc && !wc.isDestroyed() ? wc.getURL() : '',
      title: wc && !wc.isDestroyed() ? wc.getTitle() : '',
    };
  }
  async start(token: string) {
    await this.ensure();
    this.token = token;
    return this.status();
  }
  async navigate(url: string) {
    await this.ensure();
    return this.perform({ operation: 'navigate', value: url, timeoutMs: 20000 }, this.token);
  }
  async perform(command: BrowserCommand, token?: string) {
    if (!this.page || token !== this.token || this.busy)
      throw new Error('网页会话不可用、正被占用或租约已失效');
    this.busy = true;
    const page = this.page,
      view = this.view!,
      owner = view.webContents.id;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const stopped = new Promise<never>((_, reject) => {
      this.stopOperation = () => reject(new Error('网页会话已关闭'));
    });
    const task = async () => {
      await page.picker.cancel();
      if (
        command.operation === 'screenshot' &&
        (!this.window.isVisible() || this.window.isMinimized() || !this.visible)
      )
        return this.backgroundCapture(page, view, command);
      if (command.operation !== 'download') return page.perform(command);
      let resolve!: () => void, reject!: (error: Error) => void;
      const done = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void done.catch(() => {});
      this.download = { owner, path: String(command.value), resolve, reject };
      await page.perform({ ...command, operation: 'click' });
      await done;
      return { saved: true };
    };
    try {
      return await Promise.race([
        task(),
        stopped,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('网页操作超时'));
          }, command.timeoutMs ?? 15000);
        }),
      ]);
    } catch (error) {
      if (timedOut && this.view === view) await this.close();
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.download?.owner === owner) {
        this.download.item?.cancel();
        this.download = undefined;
      }
      this.stopOperation = undefined;
      this.busy = false;
    }
  }
  private async backgroundCapture(
    page: EmbeddedPage,
    view: WebContentsView,
    command: BrowserCommand,
  ) {
    const bounds = view.getBounds();
    // A newly created view under a minimized macOS window has no compositor surface.
    // Reparent this SAME page briefly to an always-hidden paint host. Never show/focus it,
    // reload the site, create a second website, or replace the run's lease.
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
    host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    host.webContents.on('will-navigate', (event) => event.preventDefault());
    const capture = { host, view };
    try {
      await host.loadURL('about:blank');
      if (this.view !== view) throw new Error('网页会话已关闭');
      this.capture = capture;
      this.window.contentView.removeChildView(view);
      host.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      view.setVisible(true);
      return await page.perform(command);
    } finally {
      if (this.capture === capture) {
        this.capture = undefined;
        if (this.view === view) {
          host.contentView.removeChildView(view);
          this.window.contentView.addChildView(view);
          view.setBounds(bounds);
        }
        this.layout();
      }
      if (!host.isDestroyed()) host.destroy();
    }
  }
  async close(token?: string) {
    if (token && token !== this.token) return;
    const view = this.view;
    this.stopOperation?.();
    this.view = undefined;
    this.token = undefined;
    this.page?.stop();
    this.page = undefined;
    this.download?.reject(new Error('网页会话已关闭'));
    this.download?.item?.cancel();
    this.download = undefined;
    if (view) {
      const parent = this.capture?.view === view ? this.capture.host : this.window;
      parent.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
    await this.websiteSession.cookies.flushStore().catch(() => {});
    this.websiteSession.flushStorageData();
  }
  async system(method: string, args: any) {
    switch (method) {
      case 'browser.embedded.pick.start':
      case 'browser.embedded.pick.validate': {
        if (this.busy) throw new Error('网页正在执行操作，请稍后选取');
        await this.ensure();
        if (this.busy) throw new Error('网页正在执行操作，请稍后选取');
        if (!this.visible || !this.window.isVisible() || this.window.isMinimized())
          throw new Error('请先展开内置网页面板');
        if (!this.permitted(this.view!.webContents.getURL())) throw new Error('请先打开测试网页');
        if (method.endsWith('.start')) return this.page!.picker.start(args.requestId);
        this.busy = true;
        try {
          await this.page!.picker.cancel();
          return await this.page!.inspectTarget(args.selector, args.framePath);
        } finally {
          this.busy = false;
        }
      }
      case 'browser.embedded.pick.status':
        return (
          this.page?.picker.status(args.requestId) ?? {
            requestId: args.requestId,
            phase: 'cancelled',
          }
        );
      case 'browser.embedded.pick.cancel':
        await this.page?.picker.cancel(args.requestId);
        return true;
      case 'browser.embedded.start':
        return this.start(args.token);
      case 'browser.embedded.perform':
        return this.perform(args.command, args.token);
      case 'browser.embedded.close':
        return this.close(args.token);
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
}
