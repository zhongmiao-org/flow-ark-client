import { contextBridge, ipcRenderer } from 'electron';
const allowed = new Set([
  'bootstrap',
  'flow.save',
  'flow.create',
  'flow.run',
  'run.detail',
  'run.list',
  'run.artifacts.preview',
  'run.artifacts.clear',
  'artifact.reveal',
  'run.control',
  'browser.discover',
  'browser.embedded.enable',
  'browser.embedded.status',
  'browser.embedded.pick.start',
  'browser.embedded.pick.status',
  'browser.embedded.pick.cancel',
  'browser.embedded.pick.validate',
  'browser.embedded.navigate',
  'browser.embedded.viewport',
  'browser.embedded.visibility',
  'script.package.inspect',
  'browser.bind',
  'schedule.save',
  'schedule.update',
  'schedule.toggle',
  'attention.read',
  'action.confirm',
  'flow.export',
  'flow.import',
  'file.choose',
  'credentials.set',
  'ai.test',
  'clipboard.copy',
  'app.showData',
]);
contextBridge.exposeInMainWorld('flowark', {
  request: (method: string, args: unknown = {}) => {
    if (!allowed.has(method)) return Promise.reject(new Error('方法未授权'));
    return ipcRenderer.invoke('flowark:request', method, args);
  },
});
