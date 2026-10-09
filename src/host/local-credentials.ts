import {
  localCredentialMethods,
  type LocalCredential,
  type LocalCredentialState,
} from '../shared/local-credentials';
export class LocalCredentialSettings {
  private writing = new Set<string>();
  private epochs = new Map<string, number>();
  constructor(
    private deps: {
      assertAvailable: () => void;
      inUse: (id: string) => boolean;
      boundFlows: (id: string) => { id: string; name: string }[];
      list: () => Promise<LocalCredential[]>;
      change: (
        id: string,
        revision: string | null,
        update?: { name: string; value?: string },
      ) => Promise<unknown>;
    },
  ) {}
  assertReadable(id: string) {
    if (this.writing.has(id)) throw new Error('凭据正在修改，请等待完成');
  }
  capture(ids: string[]) {
    const saved = ids.map((id) => {
      this.assertReadable(id);
      return [id, this.epochs.get(id) ?? 0] as const;
    });
    return () => {
      for (const [id, epoch] of saved) {
        this.assertReadable(id);
        if ((this.epochs.get(id) ?? 0) !== epoch) throw new Error('检查期间凭据已变化，请重新核对');
      }
    };
  }
  async request(method: string, raw: unknown) {
    const schema = localCredentialMethods[method as keyof typeof localCredentialMethods];
    if (!schema) throw new Error('凭据方法未授权');
    const args: any = schema.parse(raw);
    if (method === 'credential.local.list') {
      const entries = await this.deps.list();
      return entries.map((entry) => ({
        ...entry,
        boundFlows: this.deps.boundFlows(entry.id),
        inUse: this.deps.inUse(entry.id),
      })) satisfies LocalCredentialState[];
    }
    this.deps.assertAvailable();
    const id: string = args.id;
    this.assertReadable(id);
    if (this.deps.inUse(id)) throw new Error('凭据正在被活动或排队运行使用，请等待结束');
    if (method.endsWith('.remove') && this.deps.boundFlows(id).length)
      throw new Error('仍有流程绑定此凭据，请先在对应流程中移除绑定');
    this.writing.add(id);
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    try {
      return await this.deps.change(
        id,
        args.revision,
        method.endsWith('.save') ? { name: args.name, value: args.value } : undefined,
      );
    } finally {
      this.writing.delete(id);
    }
  }
}
