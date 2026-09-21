import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  utilityProcess,
  Menu,
  Tray,
  nativeImage,
  Notification,
  clipboard,
  shell,
  powerMonitor,
} from 'electron';
import { EmbeddedBrowser } from './embedded-browser';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { templateFilename, zipExportPath } from '../shared/template-filename';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { Rpc } from '../shared/rpc';
import { Vault } from './vault';
import { validateIPC } from '../shared/ipc';
import { redactArtifactText, redactedErrorText } from '../shared/utils';
import type { EmbeddedCleanupFailure, EmbeddedLostNotice } from '../shared/embedded-lifecycle';
let win: BrowserWindow;
let tray: Tray;
let quitting = false;
let quitPending = false;
let rpc: Rpc;
let host: Electron.UtilityProcess;
let startupError = '';
let embedded: EmbeddedBrowser;
let hostStopped = false;
const knownSecrets = new Set<string>();
const publicError = (error: unknown, additional: string[] = []) =>
  redactedErrorText(error, [...knownSecrets, ...additional]);
function notifyBrowserLifecycle(
  method: 'system.browserLost' | 'system.browserCleanupFailed',
  notice: EmbeddedLostNotice | EmbeddedCleanupFailure,
) {
  if (quitting || hostStopped) return;
  const unavailable = () => {
    if (quitting || hostStopped) return;
    startupError =
      '网页资源状态无法可靠通知本地宿主，执行已停止；请完整退出并重开应用后核对运行结果';
    host?.kill();
  };
  if (!rpc) unavailable();
  else void rpc.call(method, notice, 8000).catch(unavailable);
}
if (process.env.FLOWARK_DATA_DIR) app.setPath('userData', process.env.FLOWARK_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  win?.show();
  win?.focus();
});
const page = pathToFileURL(join(__dirname, 'renderer', 'index.html')).href;
async function quit() {
  if (quitting || quitPending) return;
  quitPending = true;
  try {
    try {
      const data = await rpc.call('bootstrap');
      const activeCount = data.runOverview.queued + (data.runOverview.active ? 1 : 0);
      if (activeCount) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['继续运行', '停止任务并退出'],
          defaultId: 0,
          cancelId: 0,
          message: `退出会停止 ${activeCount} 个运行及驻留计划`,
          detail: '外部操作结果未知时不会自动重试，重新打开后可查看历史。',
        });
        if (response !== 1) return;
      }
    } catch {}
    quitting = true;
    try {
      await rpc.call('shutdown', {}, 15000);
    } catch {}
    try {
      await embedded?.close();
    } catch {
      // The requested full application exit still terminates all native pages.
      // The next host boot recovers unfinished records without replaying them.
    } finally {
      try {
        host?.kill();
      } finally {
        app.quit();
      }
    }
  } finally {
    quitPending = false;
  }
}
app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    void quit();
  }
});
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      width: 1440,
      height: 960,
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 12, y: 14 },
          }
        : {}),
      minWidth: 1040,
      minHeight: 700,
      title: 'FlowArk · 序舟',
      backgroundColor: '#f6f7f8',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    embedded = new EmbeddedBrowser(
      win,
      (notice) => notifyBrowserLifecycle('system.browserLost', notice),
      (notice) => notifyBrowserLifecycle('system.browserCleanupFailed', notice),
    );
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('序舟');
    tray.setToolTip('FlowArk · 本地自动化');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 FlowArk', click: () => win.show() },
        { type: 'separator' },
        { label: '退出并停止调度', click: () => void quit() },
      ]),
    );
    tray.on('click', () => win.show());
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'FlowArk',
          submenu: [
            { label: '关于 FlowArk', role: 'about' },
            { type: 'separator' },
            {
              label: '退出 FlowArk',
              accelerator: 'CmdOrCtrl+Q',
              click: () => void quit(),
            },
          ],
        },
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
        {
          label: '窗口',
          submenu: [{ role: 'minimize' }, { label: '显示工作台', click: () => win.show() }],
        },
      ]),
    );
    const vault = new Vault(join(app.getPath('userData'), 'credentials'));
    let ready: Promise<any>;
    ipcMain.handle('flowark:request', async (event, method: string, raw: unknown) => {
      const pending =
        method === 'credentials.set' &&
        raw &&
        typeof raw === 'object' &&
        'value' in raw &&
        typeof raw.value === 'string'
          ? [raw.value]
          : [];
      try {
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          event.senderFrame.url !== page
        )
          throw new Error('IPC 来源无效');
        const args: any = validateIPC(method, raw ?? {});
        if (method === 'browser.embedded.viewport') return embedded.viewport(args);
        if (method === 'file.choose') {
          const r = await dialog.showOpenDialog(win, {
            properties: args.kind === 'directory' ? ['openDirectory'] : ['openFile'],
            title: args.kind === 'browser' ? '选择本机浏览器应用' : '选择本机资源',
          });
          return r.canceled ? null : r.filePaths[0];
        }
        if (method === 'clipboard.copy') {
          clipboard.writeText(args.value);
          return true;
        }
        if (method === 'app.showData') {
          await shell.openPath(app.getPath('userData'));
          return true;
        }
        await ready;
        if (startupError) throw new Error(startupError);
        if (method === 'artifact.reveal') {
          const path = await rpc.call('artifact.resolve', args);
          shell.showItemInFolder(path);
          return true;
        }
        if (method === 'artifact.preview') {
          const preview = await rpc.call(method, { ...args, redactionSecrets: [...knownSecrets] });
          if (preview.status !== 'text') return preview;
          const masked = redactArtifactText(preview.text, [...knownSecrets]);
          return { ...preview, ...masked, truncated: preview.truncated || masked.truncated };
        }
        if (method === 'credentials.set') {
          await vault.set(args.id, args.value);
          knownSecrets.add(args.value);
          return true;
        }
        if (method === 'flow.export') {
          const review = await dialog.showMessageBox(win, {
            buttons: ['取消', '已审阅，导出 ZIP'],
            defaultId: 0,
            cancelId: 0,
            message: '确认已审阅流程中的字面量与脚本',
            detail:
              '导出点击时的编辑内容，未保存修改不会写入本地草稿。实例配置、动作权限、本地绑定和运行历史不会导出；运行参数值也会清空。节点字面量、代码和配置定义仍会保留，请先确认其中没有个人数据或密钥。',
          });
          if (review.response !== 1) return false;
          const identity = 'local-' + randomUUID();
          const r = await dialog.showSaveDialog(win, {
            defaultPath: templateFilename(identity, '1.0.0'),
            filters: [{ name: 'FlowArk 模板', extensions: ['zip'] }],
          });
          if (r.canceled || !r.filePath) return false;
          await rpc.call(method, { ...args, identity, path: zipExportPath(r.filePath) });
          return true;
        }
        if (method === 'template.inspect') {
          const picked = await dialog.showOpenDialog(win, {
            properties: ['openFile'],
            filters: [{ name: 'FlowArk 模板包', extensions: ['zip'] }],
          });
          if (picked.canceled) return null;
          return rpc.call('template.inspect', { path: picked.filePaths[0] });
        }
        if (method === 'template.export') {
          const picked = await dialog.showSaveDialog(win, {
            defaultPath: templateFilename(...(args.key.split('@') as [string, string])),
            filters: [{ name: 'FlowArk 模板包', extensions: ['zip'] }],
          });
          if (picked.canceled || !picked.filePath) return false;
          await rpc.call('template.export', {
            key: args.key,
            path: zipExportPath(picked.filePath),
          });
          return true;
        }
        return await rpc.call(method, args);
      } catch (error) {
        throw new Error(publicError(error, pending));
      }
    });
    ready = (async () => {
      try {
        const key = await vault.key();
        knownSecrets.add(key);
        host = utilityProcess.fork(join(__dirname, 'host.cjs'), [], {
          serviceName: 'FlowArk Local Host',
          stdio: 'pipe',
          env: {
            ...process.env,
            ...(app.isPackaged
              ? {
                  ESBUILD_BINARY_PATH: join(
                    process.resourcesPath,
                    'app.asar.unpacked',
                    'node_modules',
                    '@esbuild',
                    `${process.platform}-${process.arch}`,
                    'bin',
                    'esbuild',
                  ),
                }
              : {}),
          },
        });
        rpc = new Rpc(
          (m) => host.postMessage(m),
          async (method, args) => {
            if (method === 'browser.embedded.binding')
              return {
                id: 'embedded',
                product: 'embedded',
                executable: app.getPath('exe'),
                version: process.versions.chrome,
              };
            if (method.startsWith('browser.embedded.')) return embedded.system(method, args);
            if (method === 'credentials.list') return vault.list();
            if (method === 'credentials.get') {
              const value = await vault.get(args.id);
              knownSecrets.add(value);
              return value;
            }
            if (method === 'notification') {
              if (Notification.isSupported())
                new Notification({
                  title: 'FlowArk',
                  body: '有新的待办，请打开客户端查看。',
                }).show();
              return true;
            }
            throw new Error('系统方法未授权');
          },
          publicError,
        );
        host.on('message', (m) => void rpc.receive(m));
        host.on('exit', () => {
          hostStopped = true;
          rpc.close();
          startupError ||= '本地宿主已停止，请重开应用查看中断记录';
          void embedded.close().catch(() => {
            startupError = '本地宿主已停止，网页回收未确认；请完整退出并重开应用后核对运行结果';
          });
        });
        let reportedDiagnostic = false;
        host.stderr?.on('data', () => {
          // Chunk boundaries can split a credential. Do not forward raw process diagnostics.
          if (!app.isPackaged && !reportedDiagnostic) {
            reportedDiagnostic = true;
            console.error('本地宿主产生系统诊断；原始内容未转发，请核对应用中的运行状态。');
          }
        });
        await rpc.call('init', {
          dataPath: app.getPath('userData'),
          key,
          executable: app.getPath('exe'),
        });
      } catch (e) {
        startupError = publicError(e);
      }
    })();
    await win.loadFile(join(__dirname, 'renderer', 'index.html'));
    let powerTransition = Promise.resolve();
    const power = (method: string) => {
      powerTransition = powerTransition
        .then(async () => {
          await ready;
          await rpc?.call(method, {}, 15000);
        })
        .catch(() => {});
    };
    powerMonitor.on('suspend', () => power('system.suspend'));
    powerMonitor.on('resume', () => power('system.resume'));
  })
  .catch((e) => {
    console.error(publicError(e));
    quitting = true;
    app.quit();
  });
