import { contextBridge, ipcRenderer } from 'electron';
const allowed = new Set([
  'bootstrap',
  'flow.save',
  'flow.create',
  'flow.run',
  'run.detail',
  'run.control',
  'browser.discover',
  'browser.bind',
  'schedule.save',
  'schedule.toggle',
  'attention.read',
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
