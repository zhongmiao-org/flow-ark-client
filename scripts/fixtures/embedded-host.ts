import { app, BrowserWindow } from 'electron';
import { EmbeddedBrowser } from '../../src/main/embedded-browser';
app.setPath('userData', process.env.FLOWARK_DATA_DIR!);
void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL('about:blank');
  (globalThis as any).embeddedCleanupFailures = [];
  const browser = new EmbeddedBrowser(
    window,
    (notice) => {
      (globalThis as any).lostToken = notice.token;
      (globalThis as any).lostNotice = notice;
    },
    (notice) => (globalThis as any).embeddedCleanupFailures.push(notice),
  );
  (globalThis as any).embeddedFixture = browser;
  (globalThis as any).embeddedBinding = {
    id: 'embedded',
    product: 'embedded',
    executable: app.getPath('exe'),
    version: process.versions.chrome,
  };
});
