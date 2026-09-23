import { z } from 'zod';
import {
  localCredentialId,
  localCredentialName,
  localCredentialValue,
  type LocalCredential,
} from '../shared/local-credentials';
import type { Vault } from './vault';
const record = z
  .object({
    kind: z.literal('flowark-local-credential'),
    version: z.literal(1),
    name: localCredentialName,
    value: localCredentialValue,
  })
  .strict();
export class LocalCredentials {
  private writing = new Set<string>();
  constructor(
    private vault: Pick<Vault, 'readEntry' | 'set' | 'localIds' | 'removeLocalCredential'>,
    private remember: (value: string) => void,
  ) {}
  private async read(id: string) {
    localCredentialId.parse(id);
    const entry = await this.vault.readEntry(id);
    if (!entry) return null;
    const value = record.parse(JSON.parse(entry.value));
    this.remember(value.value);
    return { record: value, revision: entry.revision };
  }
  async list(): Promise<LocalCredential[]> {
    const entries: LocalCredential[] = [];
    for (const id of await this.vault.localIds()) {
      const entry = await this.read(id);
      if (entry) entries.push({ id, name: entry.record.name, revision: entry.revision });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  async key(id: string) {
    if (this.writing.has(id)) throw new Error('凭据正在修改');
    const entry = await this.read(id);
    if (!entry || this.writing.has(id)) throw new Error('凭据不可用或正在修改');
    return entry.record.value;
  }
  async change(id: string, revision: string | null, update?: { name: string; value?: string }) {
    localCredentialId.parse(id);
    if (this.writing.has(id)) throw new Error('凭据正在修改，请等待完成');
    this.writing.add(id);
    try {
      const old = await this.read(id);
      if ((old?.revision ?? null) !== revision) throw new Error('凭据已变化，请刷新列表后重新编辑');
      if (!update) {
        if (old) await this.vault.removeLocalCredential(id);
        return true;
      }
      const next = record.parse({
        kind: 'flowark-local-credential',
        version: 1,
        name: update.name,
        value: update.value ?? old?.record.value,
      });
      this.remember(next.value);
      const saved = await this.vault.set(id, JSON.stringify(next));
      return { id, name: next.name, revision: saved } satisfies LocalCredential;
    } finally {
      this.writing.delete(id);
    }
  }
}
