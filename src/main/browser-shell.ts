import { app, BrowserWindow, Menu, session } from 'electron';
const profile = process.env.FLOWARK_BROWSER_PROFILE;
if (!profile) throw new Error('内置浏览器缺少专用会话目录');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setName('FlowArk Browser');
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});
const allowed = (url: string) => /^https?:\/\//i.test(url) || url === 'about:blank';
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.on('will-frame-navigate', (event) => {
    if (!allowed(event.url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  // Route a site's new tab into a controlled page with the same protections.
  // Showing a popup must never unhide a background session.
  contents.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) void createPage(url);
    return { action: 'deny' };
  });
});
function createPage(url = 'about:blank') {
  const oldWindows = BrowserWindow.getAllWindows();
  const visible = oldWindows.some((w) => w.isVisible() && !w.isMinimized());
  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'FlowArk · 内置浏览器',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: false,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  });
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    win.setTitle('FlowArk · ' + title + ' — ' + win.webContents.getURL());
  });
  void win.loadURL(url).catch(() => {});
  if (visible) {
    for (const old of oldWindows) old.hide();
    win.show();
  }
  return win;
}
void app.whenReady().then(() => {
  // This process uses its own default session, under the dedicated profile.
  session.defaultSession.on('will-download', (event, item, contents) => {
    const download = (globalThis as any).flowarkDownload;
    if (!download || download.state !== 'armed' || download.owner !== contents.id) {
      event.preventDefault();
      return;
    }
    download.state = 'downloading';
    download.item = item;
    item.setSavePath(download.path);
    item.once('done', (_event, state) => {
      download.state = state;
    });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.dock?.hide();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    ]),
  );
  createPage();
});
