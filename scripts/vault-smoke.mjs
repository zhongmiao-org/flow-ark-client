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
  stdin: {
    contents:
      "export { Vault } from './src/main/vault'; export { ProviderConfigurations } from './src/main/provider-configurations';",
    resolveDir: resolve('.'),
    loader: 'ts',
  },
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
globalThis.vaultTest = { ...require(${JSON.stringify(bundle)}), root: ${JSON.stringify(root)}, fs: require('node:fs/promises'), join: require('node:path').join, assert: require('node:assert/strict') };
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
      fs: { readFile, readdir, writeFile, stat, mkdir, rm },
      join,
      assert,
      Vault,
      ProviderConfigurations,
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

      const configurations = new ProviderConfigurations(vault);
      const previous = await configurations.get('deepseek');
      assert.equal(previous.configured, true);
      assert.equal(previous.tail, undefined);
      assert.equal(await configurations.key('deepseek', previous.revision), secret);
      const saved = await configurations.change('deepseek', previous.revision, {
        model: 'fictional-native-model',
        apiKey: 'fictional-native-key-R9Q4',
      });
      assert.equal(saved.tail, 'R9Q4');
      assert.equal(saved.model, 'fictional-native-model');
      assert.ok(!JSON.stringify(saved).includes('fictional-native-key'));
      const protectedConfig = await readFile(join(dir, 'deepseek.enc'));
      assert.ok(!protectedConfig.includes(Buffer.from('fictional-native')));
      assert.equal(
        await configurations.key('deepseek', saved.revision),
        'fictional-native-key-R9Q4',
      );
      const reopened = new ProviderConfigurations(new Vault(dir));
      assert.deepEqual(await reopened.get('deepseek'), saved);
      await assert.rejects(
        () => configurations.change('deepseek', previous.revision, { model: 'stale' }),
        /已变化/,
      );
      const modelOnly = await reopened.change('deepseek', saved.revision, {
        model: 'fictional-next-model',
      });
      assert.equal(modelOnly.tail, 'R9Q4');
      assert.equal(await reopened.key('deepseek', modelOnly.revision), 'fictional-native-key-R9Q4');
      checks.push(
        'real protected AI record reopens with safe metadata, CAS and blank replacement preservation',
      );

      const beforeFailure = await readFile(join(dir, 'deepseek.enc'));
      safeStorage.encryptStringAsync = async () => {
        throw new Error('injected AI encryption denial');
      };
      await assert.rejects(
        () => reopened.change('deepseek', modelOnly.revision, { model: 'must-not-save' }),
        /encryption denial/,
      );
      assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), beforeFailure);
      safeStorage.encryptStringAsync = original.encrypt;
      await mkdir(join(dir, 'deepseek.enc.tmp'));
      try {
        await assert.rejects(() =>
          reopened.change('deepseek', modelOnly.revision, { model: 'must-not-write' }),
        );
        assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), beforeFailure);
      } finally {
        await rm(join(dir, 'deepseek.enc.tmp'), { recursive: true });
      }
      safeStorage.decryptStringAsync = async () => {
        throw Object.assign(new Error('AI backend missing'), { code: 'ENOENT' });
      };
      await assert.rejects(() => reopened.get('deepseek'), /AI backend missing/);
      await assert.rejects(
        () => reopened.change('deepseek', modelOnly.revision),
        /AI backend missing/,
      );
      assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), beforeFailure);
      safeStorage.decryptStringAsync = original.decrypt;
      checks.push(
        'AI encryption, filesystem and backend failures retain the same protected revision',
      );

      await vault.set('openai-codex', 'fictional-other-provider');
      await vault.set('mcp-retained', 'fictional-other-tool');
      const others = await Promise.all(
        ['openai-codex', 'mcp-retained', 'data-key'].map((id) => readFile(join(dir, id + '.enc'))),
      );
      safeStorage.isAsyncEncryptionAvailable = async () => false;
      await assert.rejects(
        () => reopened.change('deepseek', modelOnly.revision),
        /系统安全存储不可用/,
      );
      assert.deepEqual(await readFile(join(dir, 'deepseek.enc')), beforeFailure);
      safeStorage.isAsyncEncryptionAvailable = original.available;
      assert.equal((await reopened.change('deepseek', modelOnly.revision)).configured, false);
      assert.equal((await reopened.get('deepseek')).revision, null);
      assert.deepEqual(
        await Promise.all(
          ['openai-codex', 'mcp-retained', 'data-key'].map((id) =>
            readFile(join(dir, id + '.enc')),
          ),
        ),
        others,
      );
      await assert.rejects(() => vault.removeProvider('data-key'), /AI 供应商无效/);
      await assert.rejects(() => vault.removeProvider('mcp-retained'), /AI 供应商无效/);
      await vault.removeProvider('openai-codex');
      await vault.removeToolCredential('mcp-retained');
      await writeFile(join(dir, 'deepseek.enc'), credential);
      checks.push(
        'AI removal fails closed and preserves other provider, MCP and data-key ciphertext',
      );

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
