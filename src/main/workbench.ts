import { assertReductionOutput } from '../shared/source-reduction';
import { conversationEvent } from '../shared/conversation';
import { threadEvent } from '../shared/conversation-thread';
import { archiveEvent } from '../shared/conversation-archive';
import { oauthGrant, toolSecretValues } from '../shared/mcp-oauth-grant';
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
import { selectionReference } from '../shared/desktop-windows';
import { DesktopWindows } from './desktop-windows';
import { desktopNativeMethods } from '../shared/desktop-run';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { templateFilename, zipExportPath } from '../shared/template-filename';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { Rpc } from '../shared/rpc';
import { Vault } from './vault';
import { LocalCredentials } from './local-credentials';
import { localCredentialId } from '../shared/local-credentials';
import { ProviderConfigurations } from './provider-configurations';
import { aiProvider } from '../shared/ai-settings';
import { validateIPC } from '../shared/ipc';
import { imageInfo } from '../host/attachment-file';
import { IMAGE_MAX_BYTES, TEXT_EXTENSIONS } from '../shared/task-attachments';
import { redactArtifactText, redactedErrorText } from '../shared/utils';
import type { EmbeddedCleanupFailure, EmbeddedLostNotice } from '../shared/embedded-lifecycle';
import type { Bootstrap } from '../shared/types';
let win: BrowserWindow;
let tray: Tray;
let quitting = false;
let quitPending = false;
let outputDialogPending = false;
const authorExports = new Map<string, Promise<unknown>>();
let authorDialogPending = false;
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
    let data: Bootstrap | undefined;
    try {
      data = await rpc.call('bootstrap');
    } catch {
      // A failed read cannot establish that it is safe to exit without confirmation.
    }
    const execution = data?.execution;
    const activeCount = execution?.active ? 1 : 0;
    const queuedCount = data?.runOverview.queued ?? 0;
    const planCount = data?.schedules.filter((schedule) => schedule.enabled).length ?? 0;
    if (!execution || data?.fault || activeCount || queuedCount || planCount) {
      const summary = data
        ? [
            execution
              ? `${activeCount} 个活动任务${execution.active?.phase === 'closing' ? '（正在停止）' : ''}`
              : '当前活动任务状态未知',
            `${queuedCount} 个排队任务`,
            `${planCount} 个启用计划`,
          ].join('；') + '。'
        : '暂时无法读取任务与计划状态，不能确认当前是否仍有任务。';
      try {
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: [execution ? '继续运行' : '返回工作台', '停止任务并退出'],
          defaultId: 0,
          cancelId: 0,
          message: '退出 FlowArk？',
          detail: [
            summary,
            data?.fault ? '存储不可写，排队与计划数量来自最后保存的记录。' : '',
            '退出将停止调度并取消任务；休眠和退出期间的计划不会补跑。',
            '外部操作结果未知时不会自动重试，重新打开后可查看历史并核对结果。',
          ]
            .filter(Boolean)
            .join('\n\n'),
        });
        if (response !== 1) {
          if (!execution) {
            win.show();
            win.focus();
          }
          return;
        }
      } catch {
        // A dialog failure is not the user's confirmation to stop their work.
        return;
      }
    }
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
      async (request) => {
        await ready;
        if (quitting || hostStopped || startupError) throw new Error('网页查看暂不可用');
        return rpc.call('browser.embedded.pan', request);
      },
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
    const providerConfigurations = new ProviderConfigurations(vault, (key) =>
      knownSecrets.add(key),
    );
    const localCredentials = new LocalCredentials(vault, (value) => knownSecrets.add(value));
    const desktopWindows = new DesktopWindows(
      app.isPackaged
        ? join(
            process.resourcesPath,
            'app.asar.unpacked',
            'dist',
            'native',
            'flowark-window-discovery',
          )
        : join(__dirname, 'native', 'flowark-window-discovery'),
      () => [...knownSecrets],
      (observationId) => {
        if (rpc && !hostStopped)
          void rpc.call('system.desktop.invalidate', { observationId }).catch(() => {});
      },
    );
    app.on('before-quit', () => desktopWindows.stop());
    powerMonitor.on('suspend', () => desktopWindows.stop());
    powerMonitor.on('lock-screen', () => desktopWindows.stop());
    let ready: Promise<any>;
    ipcMain.handle('flowark:request', async (event, method: string, raw: unknown) => {
      const pending =
        method === 'ai.configuration.save' &&
        raw &&
        typeof raw === 'object' &&
        'apiKey' in raw &&
        typeof raw.apiKey === 'string'
          ? [raw.apiKey]
          : [];
      if (
        method === 'tool.connection.discover' &&
        raw &&
        typeof raw === 'object' &&
        'bearerToken' in raw &&
        typeof raw.bearerToken === 'string'
      )
        pending.push(raw.bearerToken);
      if (
        method === 'credential.local.save' &&
        raw &&
        typeof raw === 'object' &&
        'value' in raw &&
        typeof raw.value === 'string'
      )
        pending.push(raw.value);
      try {
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          event.senderFrame.url !== page
        )
          throw new Error('IPC 来源无效');
        const args: any = validateIPC(method, raw ?? {});
        if (method === 'desktop.windows.list') return desktopWindows.list(args.requestId);
        if (method === 'desktop.windows.release') return desktopWindows.release(args.observationId);
        if (method === 'desktop.selection.preview') return desktopWindows.preview(args);
        if (method === 'desktop.selection.clear') return desktopWindows.clear(args);
        if (method === 'desktop.accessibility.openSettings') {
          if (process.platform !== 'darwin') throw new Error('应用窗口发现当前仅支持 macOS');
          await shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
          );
          return true;
        }
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
        if (method === 'cache.scan' || method === 'cache.clear')
          return rpc.call(method, args, 300000);
        if (method === 'cache.location') {
          const picked = await dialog.showOpenDialog(win, {
            title: '选择调试文件存放位置（将在其中创建 FlowArk调试文件）',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (picked.canceled || !picked.filePaths[0]) return null;
          return rpc.call(method, { path: join(picked.filePaths[0], 'FlowArk调试文件') });
        }
        if (method === 'cache.reveal' || method === 'cache.root') {
          const path = await rpc.call(method, args);
          if (method === 'cache.reveal') shell.showItemInFolder(path);
          else {
            const error = await shell.openPath(path);
            if (error) throw new Error(error);
          }
          return true;
        }
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
        if (method === 'credential.local.save' && args.value) knownSecrets.add(args.value);
        if (method === 'ai.configuration.save' && args.apiKey) knownSecrets.add(args.apiKey);
        if (method === 'flow.export') {
          // The application review freezes the payload and supplies reviewed:true.
          // IPC validation above and host package validation remain authoritative.
          const identity = 'local-' + randomUUID();
          const r = await dialog.showSaveDialog(win, {
            defaultPath: templateFilename(identity, '1.0.0'),
            filters: [{ name: 'FlowArk 模板', extensions: ['zip'] }],
          });
          if (r.canceled || !r.filePath) return false;
          await rpc.call(method, { ...args, identity, path: zipExportPath(r.filePath) });
          return true;
        }
        if (method === 'author.export') {
          const requestKey = JSON.stringify(args);
          const existing = authorExports.get(requestKey);
          if (existing) return await existing;
          if (authorDialogPending || quitting || hostStopped)
            throw Error('导出位置选择正在处理，请稍后核对原操作');
          const task = (async () => {
            authorDialogPending = true;
            let began = false;
            try {
              const begin = await rpc.call('author.export.begin', args);
              if (!begin.choose) return begin.receipt;
              began = true;
              const picked = await dialog.showSaveDialog(win, {
                defaultPath: templateFilename(
                  begin.receipt.package.id,
                  begin.receipt.package.version,
                ),
                filters: [{ name: 'FlowArk 模板包', extensions: ['zip'] }],
              });
              if (picked.canceled || !picked.filePath) {
                return (
                  await rpc.call('author.export.cancel', {
                    id: args.id,
                    requestId: args.requestId,
                    reviewed: true,
                  })
                ).receipt;
              }
              return await rpc.call(
                'author.export.write',
                { id: args.id, requestId: args.requestId, path: zipExportPath(picked.filePath) },
                65000,
              );
            } catch (error) {
              if (began)
                await rpc
                  .call('author.export.cancel', {
                    id: args.id,
                    requestId: args.requestId,
                    reviewed: true,
                  })
                  .catch(() => {});
              throw error;
            } finally {
              authorDialogPending = false;
            }
          })();
          authorExports.set(requestKey, task);
          try {
            return await task;
          } finally {
            authorExports.delete(requestKey);
          }
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
        return await rpc.call(
          method,
          args,
          method === 'tool.connection.oauth.authorize' ? 615000 : 65000,
        );
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
            if (method === 'conversation.message') {
              const event =
                args?.job && args?.checkpoint
                  ? (assertReductionOutput(args), args)
                  : args?.kind === 'conversation.archive.snapshot'
                    ? archiveEvent(args)
                    : args?.kind === 'conversation.thread.snapshot'
                      ? threadEvent(args)
                      : conversationEvent(args);
              if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
                win.webContents.send('flowark:conversation', event);
              return true;
            }
            if (method === 'browser.embedded.binding')
              return {
                id: 'embedded',
                product: 'embedded',
                executable: app.getPath('exe'),
                version: process.versions.chrome,
              };
            if (method === 'desktop.selection.inspect')
              return desktopWindows.inspect(selectionReference.parse(args));
            if (method === 'desktop.selection.resolve')
              return desktopWindows.resolve(selectionReference.parse(args));
            if (method === 'desktop.binding.hold') {
              const { bindingId, replacementHash, ...reference } =
                desktopNativeMethods[method].parse(args);
              return desktopWindows.hold(reference, bindingId, replacementHash);
            }
            if (method === 'desktop.binding.verify') {
              const value = desktopNativeMethods[method].parse(args);
              return desktopWindows.verifyBinding(value.bindingId, value.runId);
            }
            if (method === 'desktop.binding.claim') {
              const value = desktopNativeMethods[method].parse(args);
              return desktopWindows.claimBinding(value.bindingId, value.runId);
            }
            if (method === 'desktop.binding.release') {
              const value = desktopNativeMethods[method].parse(args);
              return desktopWindows.releaseBinding(value.bindingId, value.runId);
            }
            if (method === 'desktop.binding.write') {
              const value = desktopNativeMethods[method].parse(args);
              return desktopWindows.writeBinding(value.bindingId, value.runId, value.text);
            }
            if (method.startsWith('browser.embedded.')) return embedded.system(method, args);
            if (method === 'task.attachment.image.validate') {
              if (
                typeof args.data !== 'string' ||
                args.data.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4
              )
                throw new Error('图片超过限制');
              const bytes = Buffer.from(args.data, 'base64');
              const info = imageInfo(bytes);
              const decoded = nativeImage.createFromBuffer(bytes);
              const size = decoded.getSize();
              return !decoded.isEmpty() && size.width === info.width && size.height === info.height;
            }
            if (method === 'task.attachment.file') {
              if (outputDialogPending || quitting || hostStopped)
                throw new Error('文件选择暂不可用');
              if (!['file', 'image'].includes(args.kind)) throw new Error('附件类型无效');
              outputDialogPending = true;
              try {
                const selected = await dialog.showOpenDialog(win, {
                  title: args.kind === 'image' ? '选择目标截图' : '选择任务附件',
                  properties: ['openFile'],
                  filters: [
                    {
                      name: args.kind === 'image' ? 'PNG / JPEG 图片' : '文本与图片',
                      extensions: [
                        ...(args.kind === 'image' ? [] : TEXT_EXTENSIONS),
                        'png',
                        'jpg',
                        'jpeg',
                      ],
                    },
                  ],
                });
                return selected.canceled ? null : (selected.filePaths[0] ?? null);
              } finally {
                outputDialogPending = false;
              }
            }
            if (method === 'task.output.directory') {
              if (outputDialogPending || quitting || hostStopped)
                throw new Error('目录选择暂不可用');
              outputDialogPending = true;
              try {
                const selected = await dialog.showOpenDialog(win, {
                  title: '选择任务输出目录',
                  properties: ['openDirectory'],
                });
                return selected.canceled ? null : (selected.filePaths[0] ?? null);
              } finally {
                outputDialogPending = false;
              }
            }
            if (method === 'tool.oauth.open') {
              if (
                quitting ||
                hostStopped ||
                typeof args.url !== 'string' ||
                args.url.length > 16384
              )
                throw new Error('登录网页当前无法打开');
              const url = new URL(args.url);
              if (
                url.username ||
                url.password ||
                url.hash ||
                !(
                  url.protocol === 'https:' ||
                  (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))
                ) ||
                url.searchParams.get('response_type') !== 'code' ||
                url.searchParams.get('code_challenge_method') !== 'S256'
              )
                throw new Error('登录网页地址无效');
              try {
                await shell.openExternal(url.href);
              } catch {
                throw new Error('系统未能确认登录网页已打开，请取消后重新检查');
              }
              return true;
            }
            if (method === 'credentials.list') return vault.list();
            if (
              [
                'credential.local.read',
                'credential.local.write',
                'credential.local.check',
              ].includes(method)
            ) {
              try {
                if (method === 'credential.local.read') return await localCredentials.list();
                if (method === 'credential.local.check') {
                  for (const id of localCredentialId.array().max(30).parse(args.ids))
                    await localCredentials.key(id);
                  return true;
                }
                return await localCredentials.change(args.id, args.revision, args.update);
              } catch (error) {
                if (error instanceof Error && error.message === '凭据已变化，请刷新列表后重新编辑')
                  throw error;
                throw new Error('凭据读取或修改未完成，请检查系统保护存储并刷新列表核对');
              }
            }
            if (method === 'ai.configuration.read') {
              try {
                return await providerConfigurations.get(aiProvider.parse(args.provider));
              } catch {
                throw new Error('AI 配置读取未完成，请检查系统保护存储后重试');
              }
            }
            if (method === 'ai.configuration.write') {
              if (args.update?.apiKey) knownSecrets.add(args.update.apiKey);
              try {
                return await providerConfigurations.change(
                  aiProvider.parse(args.provider),
                  args.revision,
                  args.update,
                );
              } catch (error) {
                if (error instanceof Error && error.message === 'AI 配置已变化，请重新读取后保存')
                  throw error;
                throw new Error(
                  'AI 配置保存或移除未完成，原配置保持不变；请检查系统保护存储后重试',
                );
              }
            }
            if (
              method === 'tool.credentials.set' ||
              method === 'tool.credentials.remove' ||
              method === 'tool.credentials.get'
            ) {
              if (!/^mcp-[a-zA-Z0-9_-]{1,80}$/.test(args.id)) throw new Error('工具凭据 ID 无效');
              if (method === 'tool.credentials.get') {
                const value = await vault.get(args.id);
                for (const secret of toolSecretValues(value)) knownSecrets.add(secret);
                return value;
              }
              if (method === 'tool.credentials.remove') await vault.removeToolCredential(args.id);
              else {
                if (typeof args.value !== 'string' || args.value.length > 65536)
                  throw new Error('工具凭据无效');
                if (!/^[\x21-\x7e]{1,8192}$/.test(args.value)) {
                  try {
                    oauthGrant.parse(JSON.parse(args.value));
                  } catch {
                    throw new Error('工具凭据包无效');
                  }
                }
                for (const secret of toolSecretValues(args.value)) knownSecrets.add(secret);
                await vault.set(args.id, args.value);
              }
              return true;
            }
            if (method === 'credentials.get') {
              let value: string;
              if (localCredentialId.safeParse(args.id).success) {
                try {
                  value = await localCredentials.key(args.id);
                } catch {
                  throw new Error('本机凭据读取未完成，请检查系统保护存储或重新绑定');
                }
              } else
                value = await providerConfigurations.key(aiProvider.parse(args.id), args.revision);
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
