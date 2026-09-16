import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
export class Vault {
  constructor(private dir: string) {}
  private async available() {
    if (
      !(await safeStorage.isAsyncEncryptionAvailable()) ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('系统安全存储不可用，已阻止保存；不会明文降级');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }
  private path(id: string) {
    if (!/^[\w-]{1,100}$/.test(id)) throw new Error('凭据 ID 无效');
    return join(this.dir, id + '.enc');
  }
  async set(id: string, value: string) {
    await this.available();
    const path = this.path(id);
    await writeFile(path + '.tmp', await safeStorage.encryptStringAsync(value), { mode: 0o600 });
    await rename(path + '.tmp', path);
  }
  async get(id: string) {
    await this.available();
    const encrypted = await readFile(this.path(id));
    return (await safeStorage.decryptStringAsync(encrypted)).result;
  }
  async key() {
    try {
      return await this.get('data-key');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      const key = randomBytes(32).toString('base64');
      await this.set('data-key', key);
      return key;
    }
  }
  async list() {
    const found: string[] = [];
    for (const id of ['openai-codex', 'deepseek'])
      try {
        await readFile(this.path(id));
        found.push(id);
      } catch {}
    return found;
  }
}
