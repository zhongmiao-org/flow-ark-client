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
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { Rpc } from '../shared/rpc';
import { Vault } from './vault';
import { validateIPC } from '../shared/ipc';
import { errorText } from '../shared/utils';
let win: BrowserWindow;
let tray: Tray;
let quitting = false;
let quitPending = false;
let rpc: Rpc;
let host: Electron.UtilityProcess;
let startupError = '';
let embedded: EmbeddedBrowser;
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
    await embedded?.close();
    host?.kill();
    app.quit();
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
      width: 1380,
      height: 900,
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
    embedded = new EmbeddedBrowser(win, (token) => {
      void rpc?.call('system.browserLost', { token }).catch(() => {});
    });
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
      if (method === 'credentials.set') {
        await vault.set(args.id, args.value);
        return true;
      }
      if (method === 'flow.export') {
        const content = await rpc.call(method, args);
        const review = await dialog.showMessageBox(win, {
          buttons: ['取消', '已审阅，导出模板'],
          defaultId: 0,
          cancelId: 0,
          message: '确认已审阅流程中的字面量与脚本',
          detail:
            '导出点击时的编辑内容，未保存修改不会写入本地草稿。账号、简历事实、动作权限、本地绑定和运行历史不会导出；运行参数值也会清空。节点字面量、代码和配置定义仍会保留，请先确认其中没有个人数据或密钥。',
        });
        if (review.response !== 1) return false;
        const r = await dialog.showSaveDialog(win, {
          defaultPath: 'flowark-template.json',
          filters: [{ name: 'FlowArk 模板', extensions: ['json'] }],
        });
        if (r.canceled || !r.filePath) return false;
        await writeFile(r.filePath, content, { mode: 0o600 });
        return true;
      }
      if (method === 'flow.import') {
        const r = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'FlowArk 模板', extensions: ['json'] }],
        });
        if (r.canceled) return null;
        const content = await readFile(r.filePaths[0], 'utf8');
        if (content.length > 2 * 1024 * 1024) throw new Error('模板超过 2 MiB');
        const answer = await dialog.showMessageBox(win, {
          buttons: ['取消', '导入为新草稿'],
          defaultId: 0,
          cancelId: 0,
          message: '确认模板来源可信',
          detail: '模板可能包含可信脚本。导入只创建草稿，运行前请审阅所有节点和代码。',
        });
        return answer.response === 1 ? rpc.call(method, { content }) : null;
      }
      return rpc.call(method, args);
    });
    ready = (async () => {
      try {
        const key = await vault.key();
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
            if (method === 'credentials.get') return vault.get(args.id);
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
        );
        host.on('message', (m) => void rpc.receive(m));
        host.on('exit', () => {
          rpc.close();
          void embedded.close();
          startupError = '本地宿主已停止，请重开应用查看中断记录';
        });
        host.stderr?.on('data', (b) => {
          if (!app.isPackaged) process.stderr.write(b);
        });
        await rpc.call('init', {
          dataPath: app.getPath('userData'),
          key,
          executable: app.getPath('exe'),
        });
      } catch (e) {
        startupError = errorText(e);
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
    console.error(errorText(e));
    quitting = true;
    app.quit();
  });
