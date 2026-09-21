import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { desktopElectron as _electron } from './desktop-session.mjs';
import { killOwnedTree } from '../src/host/processes.ts';

const root = await mkdtemp(join(tmpdir(), 'flowark-vault-test-'));
const bundle = join(root, 'vault.cjs');
await build({
  entryPoints: [resolve('src/main/vault.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const entry = join(root, 'main.cjs');
await writeFile(
  entry,
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(root, 'app-data'))});
globalThis.vaultTest = { Vault: require(${JSON.stringify(bundle)}).Vault, root: ${JSON.stringify(root)}, fs: require('node:fs/promises'), join: require('node:path').join, assert: require('node:assert/strict') };
app.whenReady().then(() => { globalThis.testWindow = new BrowserWindow({ show: false }); globalThis.testWindow.loadURL('about:blank'); });`,
);
const application = await _electron.launch({
  executablePath: resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [entry],
  timeout: 15000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
let result;
let timedOut = false;
const watchdog = setTimeout(() => {
  timedOut = true;
  void killOwnedTree(application.process());
}, 30000);
try {
  result = await application.evaluate(async ({ app, safeStorage }) => {
    await app.whenReady();
    const {
      fs: { readFile, readdir, writeFile, stat },
      join,
      assert,
      Vault,
      root,
    } = globalThis.vaultTest;
    const original = {
      available: safeStorage.isAsyncEncryptionAvailable,
      encrypt: safeStorage.encryptStringAsync,
      decrypt: safeStorage.decryptStringAsync,
    };
    const checks = [];
    try {
      const dir = join(root, 'credentials');
      const vault = new Vault(dir);
      const secret = 'fictional-vault-check-only';
      await vault.set('deepseek', secret);
      assert.equal(await vault.get('deepseek'), secret);
      const credential = await readFile(join(dir, 'deepseek.enc'));
      assert.ok(!credential.includes(Buffer.from(secret)));
      assert.equal((await stat(join(dir, 'deepseek.enc'))).mode & 0o777, 0o600);
      const key = await vault.key();
      const keyPath = join(dir, 'data-key.enc');
      const encryptedKey = await readFile(keyPath);
      assert.ok(!encryptedKey.includes(Buffer.from(key)));
      checks.push('real system encryption round trip and file permissions');

      await vault.set('mcp-fixture', 'fictional-connection-only');
      assert.equal(await vault.get('mcp-fixture'), 'fictional-connection-only');
      await assert.rejects(() => vault.removeToolCredential('data-key'), /工具凭据 ID 无效/);
      await assert.rejects(() => vault.removeToolCredential('deepseek'), /工具凭据 ID 无效/);
      const toolCiphertext = await readFile(join(dir, 'mcp-fixture.enc'));
      safeStorage.isAsyncEncryptionAvailable = async () => false;
      await assert.rejects(() => vault.removeToolCredential('mcp-fixture'), /系统安全存储不可用/);
      assert.deepEqual(await readFile(join(dir, 'mcp-fixture.enc')), toolCiphertext);
      safeStorage.isAsyncEncryptionAvailable = original.available;
      await vault.removeToolCredential('mcp-fixture');
      await vault.removeToolCredential('mcp-fixture');
      await assert.rejects(() => readFile(join(dir, 'mcp-fixture.enc')), { code: 'ENOENT' });
      assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), credential);
      assert.deepEqual(await readFile(keyPath), encryptedKey);
      checks.push(
        'MCP removal is namespace-limited and preserves provider credentials and data key',
      );

      safeStorage.isAsyncEncryptionAvailable = async () => false;
      await assert.rejects(
        () => vault.set('deepseek', 'fictional-replacement'),
        /系统安全存储不可用/,
      );
      await assert.rejects(() => vault.get('deepseek'), /系统安全存储不可用/);
      await assert.rejects(() => vault.key(), /系统安全存储不可用/);
      const empty = new Vault(join(root, 'blocked-credentials'));
      await assert.rejects(() => empty.key(), /系统安全存储不可用/);
      await assert.rejects(() => stat(join(root, 'blocked-credentials')), { code: 'ENOENT' });
      assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), credential);
      assert.deepEqual(await readFile(keyPath), encryptedKey);
      checks.push('unavailable system storage blocks reads writes and first key creation');
      safeStorage.isAsyncEncryptionAvailable = original.available;

      safeStorage.isAsyncEncryptionAvailable = async () => {
        throw Object.assign(new Error('injected availability check failure'), { code: 'ENOENT' });
      };
      await assert.rejects(() => vault.key(), /availability check failure/);
      assert.deepEqual(await readFile(keyPath), encryptedKey);
      checks.push('availability backend error preserves existing data key');
      safeStorage.isAsyncEncryptionAvailable = original.available;

      safeStorage.encryptStringAsync = async () => {
        throw new Error('injected encryption denial');
      };
      await assert.rejects(
        () => vault.set('deepseek', 'fictional-replacement'),
        /encryption denial/,
      );
      assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), credential);
      assert.ok(!(await readdir(dir)).some((name) => name.endsWith('.tmp')));
      checks.push('encryption failure preserves old ciphertext without temporary plaintext');
      safeStorage.encryptStringAsync = original.encrypt;

      // ENOENT from the protection backend must not mean that the encrypted key file is missing.
      safeStorage.decryptStringAsync = async () => {
        throw Object.assign(new Error('injected protection backend missing'), { code: 'ENOENT' });
      };
      await assert.rejects(() => vault.key(), /protection backend missing/);
      assert.deepEqual(await readFile(keyPath), encryptedKey);
      checks.push('backend decryption failure never replaces an existing data key');
      safeStorage.decryptStringAsync = original.decrypt;

      await writeFile(keyPath, Buffer.from('invalid-fictional-ciphertext'));
      await assert.rejects(() => vault.key());
      assert.equal(await readFile(keyPath, 'utf8'), 'invalid-fictional-ciphertext');
      await writeFile(keyPath, encryptedKey);
      assert.equal(await vault.key(), key);
      assert.deepEqual((await readdir(dir)).sort(), ['data-key.enc', 'deepseek.enc']);
      checks.push('corrupt ciphertext is preserved and restored original key still decrypts');
      return { passed: true, checks };
    } catch (error) {
      return { passed: false, checks, error: String(error) };
    } finally {
      safeStorage.isAsyncEncryptionAvailable = original.available;
      safeStorage.encryptStringAsync = original.encrypt;
      safeStorage.decryptStringAsync = original.decrypt;
    }
  });
} catch (error) {
  result = { passed: false, error: String(error) };
} finally {
  try {
    await application.close();
  } catch (error) {
    result = { ...result, passed: false, closeError: String(error) };
  } finally {
    clearTimeout(watchdog);
  }
}
if (timedOut) result = { ...result, passed: false, timedOut: true };
await mkdir(resolve('test-results'), { recursive: true });
await writeFile(resolve('test-results/vault.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
assert.ok(result?.passed, '系统凭据存储故障验证失败，见 test-results/vault.json');
