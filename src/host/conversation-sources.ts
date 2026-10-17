import {
  assertConversationSourceNode,
  conversationSourceRead,
  validateConversationSourceRead,
} from '../../contracts/conversation-source';
import type { ConversationArchives } from './conversation-archives';
import type { Store } from './store';
import {
  sourceRefSchema,
  assertSourceResult,
  type SourceTarget,
  type SourceNode,
} from '../shared/conversation-source';
import type {
  ConversationArchiveRef as Ref,
  ConversationArchiveManifest as Manifest,
} from '../shared/conversation-archive';
import type { Bindings, Flow, FlowRecord } from '../shared/types';
import { digest } from '../shared/utils';
import { walk } from '../core/validate';
type Resources = NonNullable<Bindings['resources']>;
export type SourceOwner = {
  revision: string;
  fingerprint: string;
  resources: Resources;
  sourceIds?: string[];
};
type Grant = { fingerprint: string; expires: number };
const equal = (a: unknown, b: unknown) => digest(a ?? null) === digest(b ?? null);
export class ConversationSources {
  private grants = new Map<string, Grant>();
  constructor(
    private store: Store,
    private archives: ConversationArchives,
    private deps: {
      available: () => void;
      owner: (kind: SourceTarget['kind'], id: string) => SourceOwner;
      current: (manifest: Manifest) => boolean;
    },
  ) {}
  private owner(target: SourceTarget) {
    this.deps.available();
    const owner = this.deps.owner(target.kind, target.id);
    if (owner.revision !== target.revision)
      throw Error('目标流程或实例已变化，请重新读取后选择来源；原绑定保留');
    return owner;
  }
  private key(target: Pick<SourceTarget, 'kind' | 'id'>, binding: string, ref: Ref) {
    return digest({ kind: target.kind, id: target.id, binding, ref });
  }
  private binding(value: Resources[string] | undefined): Ref {
    if (!value || Object.keys(value).some((k) => k !== 'source'))
      throw Error('完整来源需要独立只读引用，不能混入路径或其他资源');
    return sourceRefSchema.parse(value.source);
  }
  private choice(ref: Ref) {
    const { manifest: m, confirmedAt } = this.archives.sourceInfo(ref);
    let current: boolean | null = null;
    try {
      current = this.deps.current(m);
    } catch {
      /* unavailable is distinct from stale */
    }
    return {
      ref,
      title: m.capture.title,
      confirmedAt,
      requestCount: m.requestCount,
      originRequestCount: m.originRequestCount,
      historyCount: m.historyCount,
      contextCount: m.contextCount,
      failedCount: m.failedCount,
      cancelledCount: m.cancelledCount,
      current,
      currentError: current === null ? '原会话或资料暂不可核对，未认定为当前来源' : '',
    };
  }
  list(
    target: SourceTarget,
    query: string,
    cursor: { ceiling: number; before: number; query: string } | null,
  ) {
    this.owner(target);
    const ceiling = cursor?.ceiling ?? this.store.lastPosition('conversation-archive-manifest');
    const before = cursor?.before ?? ceiling + 1;
    if (
      cursor &&
      (cursor.query !== query ||
        before > ceiling + 1 ||
        ceiling > this.store.lastPosition('conversation-archive-manifest'))
    )
      throw Error('来源目录位置已失效，请重新搜索');
    const rows = this.store.page<Manifest>('conversation-archive-manifest', ceiling, before, 20);
    const choices = rows
      .filter((r) => r.value.capture.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map(({ value: m }) =>
        this.choice({
          version: 1,
          archiveId: m.id,
          sessionId: m.capture.sessionId,
          sha256: m.sha256,
        }),
      );
    return {
      choices,
      next: rows.length === 20 ? { ceiling, before: rows.at(-1)!.position, query } : null,
    };
  }
  select(target: SourceTarget, binding: string, ref: Ref) {
    const owner = this.owner(target);
    if (owner.sourceIds && !owner.sourceIds.includes(binding))
      throw Error('目标实例未声明此只读来源资源');
    const choice = this.choice(ref);
    if (choice.current === null) throw Error(choice.currentError);
    for (const [key, g] of this.grants) if (g.expires <= Date.now()) this.grants.delete(key);
    if (this.grants.size >= 512) throw Error('来源选择核对数量达到上限，请稍后重试');
    this.grants.set(this.key(target, binding, ref), {
      fingerprint: owner.fingerprint,
      expires: Date.now() + 10 * 60000,
    });
    return choice;
  }
  inspect(target: SourceTarget, binding: string, ref: Ref) {
    const owner = this.owner(target),
      grant = this.grants.get(this.key(target, binding, ref));
    if (
      !equal(owner.resources[binding], { source: ref }) &&
      (!grant || grant.fingerprint !== owner.fingerprint || grant.expires <= Date.now())
    )
      throw Error('来源未由此目标明确选择，或核对已过期；请重新选择');
    return { ...this.choice(ref), manifest: this.archives.readSource(ref) };
  }
  page(target: SourceTarget, binding: string, ref: Ref, cursor: any) {
    this.inspect(target, binding, ref);
    return this.archives.page(ref.sessionId, ref.archiveId, cursor);
  }
  assertChanges(
    target: Pick<SourceTarget, 'kind' | 'id'>,
    fingerprint: string,
    before: Resources,
    next: Resources,
    allowed: string[],
  ) {
    for (const [binding, value] of Object.entries(next)) {
      if (!value.source) continue;
      const ref = this.binding(value);
      this.archives.sourceInfo(ref);
      if (equal(before[binding], value)) continue;
      if (!allowed.includes(binding)) throw Error('流程或实例未声明对应来源资源');
      const grant = this.grants.get(this.key(target, binding, ref));
      if (!grant || grant.fingerprint !== fingerprint || grant.expires <= Date.now())
        throw Error('来源选择未核对、已过期或目标已变化；请通过来源选择器重新选择');
    }
  }
  assertFlow(previous: FlowRecord | undefined, flow: Flow, bindings: Bindings) {
    const next = bindings.resources ?? {};
    if (!Object.values(next).some((v) => v.source)) return;
    if (!previous) throw Error('请先保存流程，再为其选择来源');
    this.assertChanges(
      { kind: 'flow', id: previous.id },
      digest(previous),
      previous.bindings.resources ?? {},
      next,
      walk(flow.steps)
        .filter((n): n is SourceNode => n.type === 'source')
        .map((n) => n.binding),
    );
  }
  assertBinding(record: FlowRecord, binding: string) {
    const ref = this.binding(record.bindings.resources?.[binding]);
    this.archives.sourceInfo(ref);
    return ref;
  }
  perform(record: FlowRecord, node: SourceNode, cursor: unknown) {
    assertConversationSourceNode(node, record.flow.requiredCapabilities);
    const ref = this.assertBinding(record, node.binding),
      manifest = this.archives.readSource(ref);
    if (node.operation === 'manifest')
      return { version: 1, source: ref, manifest, current: this.deps.current(manifest) };
    const ordinal = cursor === null ? 1 : (cursor as any)?.recordOrdinal;
    const row = this.archives.sourceRecord(ref, ordinal);
    return conversationSourceRead(
      manifest,
      cursor,
      row,
      ordinal === 1 ? null : this.archives.sourceRecord(ref, ordinal - 1),
    );
  }
  verifyResult(record: FlowRecord, node: SourceNode, value: unknown) {
    assertSourceResult(value);
    const ref = this.assertBinding(record, node.binding),
      manifest = this.archives.readSource(ref),
      v = value as any;
    if (node.operation === 'manifest') {
      if (!equal(v.source, ref) || !equal(v.manifest, manifest) || typeof v.current !== 'boolean')
        throw Error('来源清单结果与固定快照不一致');
    } else {
      if (!equal(v.cursor?.source, ref)) throw Error('读取结果不属于运行固定来源');
      const ordinal = v.cursor.recordOrdinal;
      validateConversationSourceRead(
        v,
        manifest,
        this.archives.sourceRecord(ref, ordinal),
        ordinal === 1 ? null : this.archives.sourceRecord(ref, ordinal - 1),
      );
    }
  }
  record(ref: Ref, ordinal: number) {
    return this.archives.sourceRecord(ref, ordinal);
  }
}
