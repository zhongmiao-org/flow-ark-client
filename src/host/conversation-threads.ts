import { randomBytes } from 'node:crypto';
import {
  conversationContextHash,
  conversationThreadSeed,
  conversationEntryHash,
  conversationPreparedHash,
  conversationCheckpointHash,
  validateConversationContext,
  validateConversationThread,
  validateConversationEntry,
  validateConversationHistoryPage,
  resolveConversationSelection,
  validateConversationPrepared,
  validateConversationCheckpoint,
  validateCurrentConversationCheckpoint,
  conversationCheckpointEvidence,
  verifyConversationCheckpointEvidence,
  validateConversationContextProposal,
  conversationThreadOutput,
} from '../../contracts/continuous-conversation';
import { conversationOutput } from '../../contracts/skill-trial';
import {
  streamConversation,
  type ConversationInput,
  type ConversationReply,
} from '../ai/conversation-stream';
import { aiBinding } from '../shared/ai-node';
import { aiUsage } from '../shared/ai-outcome';
import type { AIConfiguration } from '../shared/ai-settings';
import type { FlowRecord, Json } from '../shared/types';
import { conversationBytes, type ConversationSnapshot } from '../shared/conversation';
import {
  assertThreadPrepared,
  type ThreadNode,
  type ConversationThreadSnapshot as Head,
  type ConversationThreadEntry as Entry,
  type ConversationContext as Context,
  type ConversationThreadEvent,
  type ConversationHistorySelection as Selection,
  type ConversationHistoryCursor as Cursor,
  type ConversationHistoryPage,
  type ConversationThreadPrepared as Prepared,
  type ConversationCheckpoint as Checkpoint,
  type ConversationContextProposal,
  type ThreadCheckpointSource,
  type ThreadPreparedPreview,
  type ThreadCheckpointPreview,
  type ThreadReceipt,
} from '../shared/conversation-thread';
import { digest, now, uid, redactedErrorText } from '../shared/utils';
import type { Store } from './store';
import { abortable, ConversationCapacity } from './conversation-request';
import {
  conversationArchiveCapture,
  validateCurrentConversationArchive,
} from '../../contracts/conversation-archive';

type Saved = {
  scope: string;
  key: string;
  snapshot: Head;
  completeOrdinal: number;
  contextRevision: number;
};
type LegacySource = { scope: string; key: string; snapshot: ConversationSnapshot };
type Job = { id: string; provider: string; abort: AbortController; done: Promise<void> };
type SendGrant = {
  kind: 'send';
  sessionId: string;
  preparedId: string;
  hash: string;
  expires: number;
  configuration: AIConfiguration;
};
type CheckpointGrant = {
  kind: 'checkpoint';
  sessionId: string;
  source: ThreadCheckpointSource;
  hash: string;
  expires: number;
};
const kinds = {
  head: 'conversation-thread',
  index: 'conversation-thread-index',
  context: 'conversation-thread-context',
  entry: 'conversation-thread-entry',
  complete: 'conversation-thread-complete',
  input: 'conversation-thread-input',
  request: 'conversation-thread-request',
  active: 'conversation-thread-active',
  checkpoint: 'conversation-thread-checkpoint',
  confirmation: 'conversation-thread-confirmation',
  proposal: 'conversation-thread-proposal',
};
const ref = (c: Context) => ({ id: c.id, sha256: c.sha256 });
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const key = (id: string, value: string | number) => digest({ id, value });

/** Persistent history is independent of the bounded UI/model window. No business prompts or external actions. */
export class ConversationThreads {
  private jobs = new Map<string, Job>();
  private grants = new Map<string, SendGrant | CheckpointGrant>();
  constructor(
    private store: Store,
    private deps: {
      available: () => void;
      configuration: (provider: 'deepseek' | 'openai-codex') => Promise<AIConfiguration>;
      key: (provider: string, revision: string) => Promise<string>;
      publish: (event: ConversationThreadEvent) => Promise<unknown>;
      notify: () => Promise<unknown>;
      origin: (id: string, revision?: number) => LegacySource;
      capacity: ConversationCapacity;
      generate?: typeof streamConversation;
    },
  ) {
    // At most four active markers; never enumerate the history or all heads at startup.
    const active = store.list<{ id: string; requestId: string }>(kinds.active);
    if (active.length > 4) throw Error('持续会话恢复索引异常，未自动发起请求');
    for (const marker of active) {
      const s = this.get(marker.id).snapshot;
      if (s.active?.requestId === marker.requestId)
        this.finish(
          marker.id,
          marker.requestId,
          'cancelled',
          '上次请求已中断；部分内容保留，未自动续费或重试。',
        );
      else if (!s.active) {
        const receipt = this.receipt(marker.id, marker.requestId);
        if (!receipt || receipt.ordinal === null) throw Error('持续会话恢复缺少原终态回执');
        store.remove(kinds.active, marker.id);
      } else throw Error('持续会话恢复身份不一致，请保留资料并核对');
    }
  }
  usesProvider(provider: string) {
    return [...this.jobs.values()].some((j) => j.provider === provider);
  }
  private get(id: string, revision?: number): Saved {
    const saved = this.store.get<Saved>(kinds.head, id);
    if (!saved) throw Error('持续会话不存在');
    validateConversationThread(saved.snapshot);
    if (
      !Number.isSafeInteger(saved.completeOrdinal) ||
      saved.completeOrdinal < 0 ||
      saved.completeOrdinal > saved.snapshot.historyCount ||
      !Number.isSafeInteger(saved.contextRevision) ||
      saved.contextRevision < 1 ||
      saved.contextRevision > saved.snapshot.revision
    )
      throw Error('持续会话索引无效');
    if (revision !== undefined && saved.snapshot.revision !== revision)
      throw Error('会话已变化，输入保留；请重新读取并核对');
    return saved;
  }
  detail(id: string): Head {
    return structuredClone(this.get(id).snapshot);
  }
  private immutable(kind: string, id: string, value: unknown) {
    const old = this.store.get(kind, id);
    if (old !== undefined) {
      if (!same(old, value)) throw Error('固定会话记录身份已使用，未覆盖内容');
      return;
    }
    this.store.put(kind, id, value);
  }
  private emit(s: Head) {
    const latest = s.active ?? s.lastEntry;
    const event: ConversationThreadEvent = structuredClone({
      kind: 'conversation.thread.snapshot',
      eventId: `thread:${s.id}:${s.sequence}`,
      sessionId: s.id,
      sequence: s.sequence,
      requestId: latest?.requestId ?? null,
      turnId: latest?.turnId ?? null,
      snapshot: s,
    });
    void this.deps.publish(event).catch(() => {});
  }
  private attention(s: Head) {
    const item = this.store.attention(
      'confirmation',
      s.title,
      {
        conversationThreadId: s.id,
        message: '可随时补充；确认当前来源不等于发布Skill或发送授权。',
      },
      'conversation-thread:' + s.id,
    );
    this.store.put('attention', item.id, {
      ...item,
      read: s.checkpointCurrent,
      detail: { ...item.detail, status: s.status, checkpointCurrent: s.checkpointCurrent },
    });
  }
  private commit(saved: Saved, extra: () => void = () => {}, revision = true) {
    const s = saved.snapshot;
    if (s.sequence >= Number.MAX_SAFE_INTEGER - 1 || s.revision >= Number.MAX_SAFE_INTEGER - 1)
      throw Error('会话修订达到可表示范围，历史保留');
    s.sequence++;
    if (revision) s.revision++;
    s.updatedAt = now();
    validateConversationThread(s);
    this.store.tx(() => {
      extra();
      this.store.put(kinds.head, s.id, saved);
      this.attention(s);
    });
    this.emit(s);
    return structuredClone(s);
  }
  private makeContext(
    flowId: string,
    nodeId: string,
    title: string,
    provider: Context['provider'],
    model: string,
    instructions: string,
    context: Json,
  ): Context {
    const value = {
      version: 1 as const,
      id: uid(),
      flowId,
      nodeId,
      title,
      provider,
      model,
      instructions,
      context,
      sha256: '',
    };
    value.sha256 = conversationContextHash(value);
    validateConversationContext(value);
    return value;
  }
  context(id: string): Context {
    const s = this.get(id).snapshot,
      c = this.store.get<Context>(kinds.context, s.context.id);
    validateConversationContext(c);
    if (!c || !same(ref(c), s.context)) throw Error('固定上下文身份不一致');
    return structuredClone(c);
  }
  origin(id: string): ConversationSnapshot | null {
    const s = this.get(id).snapshot;
    if (!s.origin) return null;
    const source = this.deps.origin(s.origin.sessionId).snapshot;
    const e = conversationOutput(source).evidence;
    if (!e || !same({ ...e, label: '' }, { ...s.origin, label: '' }))
      throw Error('原访谈来源不一致');
    return source;
  }
  private create(
    scope: string,
    threadKey: string,
    c: Context,
    historyWindow: number,
    origin: Head['origin'] = null,
    id: string = uid(),
  ) {
    const index = digest({ scope, key: threadKey });
    if (this.store.get(kinds.index, index) || this.store.get(kinds.head, id))
      throw Error('持续档案已存在，未合并其他来源');
    const s: Head = {
      formatVersion: '2.0',
      id,
      flowId: c.flowId,
      nodeId: c.nodeId,
      title: c.title,
      context: ref(c),
      origin,
      historyWindow,
      revision: 1,
      sequence: 1,
      status: 'draft',
      draft: '',
      requestCount: 0,
      turnCount: 0,
      historyCount: 0,
      historyHash: conversationThreadSeed(id, origin),
      active: null,
      lastEntry: null,
      latestCheckpoint: null,
      checkpointCurrent: false,
      updatedAt: now(),
      error: '',
      contextProposalId: null,
    };
    validateConversationThread(s);
    this.store.tx(() => {
      this.immutable(kinds.context, c.id, c);
      this.store.put(kinds.index, index, { id });
      this.store.put(kinds.head, id, {
        scope,
        key: threadKey,
        snapshot: s,
        completeOrdinal: 0,
        contextRevision: 1,
      } satisfies Saved);
      this.attention(s);
    });
    this.emit(s);
    void this.deps.notify().catch(() => {});
    return structuredClone(s);
  }
  continue(id: string, revision: number) {
    this.deps.available();
    const old = this.deps.origin(id, revision),
      o = old.snapshot,
      evidence = conversationOutput(o).evidence;
    if (!evidence) throw Error('需要真实已确认的普通访谈来源');
    const existing = this.store.get<Saved>(kinds.head, id);
    if (existing) {
      if (
        !existing.snapshot.origin ||
        !same({ ...existing.snapshot.origin, label: '' }, { ...evidence, label: '' })
      )
        throw Error('此身份已关联其他来源');
      return this.detail(id);
    }
    const c = this.makeContext(
      o.flowId,
      o.nodeId,
      o.title,
      o.provider,
      o.model,
      o.instructions,
      o.context,
    );
    return this.create(old.scope, old.key, c, 12, evidence, o.id);
  }
  open(
    record: FlowRecord,
    node: ThreadNode,
    input: Json,
    threadKey: unknown,
    sourceRunId: string,
    check: () => void,
  ) {
    this.deps.available();
    check();
    if (typeof threadKey !== 'string' || !threadKey.trim() || threadKey.length > 100)
      throw Error('会话键须为1–100字符非空文本');
    const binding = aiBinding(record.bindings, node.binding);
    const scope = record.bindings.template
      ? 'instance:' + record.bindings.template.instanceId
      : 'flow:' + record.id;
    const index = digest({ scope, key: threadKey }),
      previous = this.store.get<{ id: string }>(kinds.index, index);
    const proposed = this.makeContext(
      record.id,
      node.id,
      node.title,
      binding.provider,
      binding.model,
      node.instructions,
      input,
    );
    if (!previous) {
      check();
      const s = this.create(scope, threadKey, proposed, node.historyWindow);
      return this.output(s.id);
    }
    const saved = this.get(previous.id),
      s = saved.snapshot;
    if (saved.scope !== scope || saved.key !== threadKey) throw Error('持续会话归属索引不一致');
    if (proposed.sha256 === s.context.sha256 && node.historyWindow === s.historyWindow)
      return this.output(s.id);
    if (s.active || this.jobs.has(s.id)) throw Error('正在生成，资料更新保留到本轮结束后核对');
    if (s.contextProposalId) {
      const prior = this.proposal(s.id)!;
      if (prior.proposed.sha256 !== proposed.sha256 || prior.historyWindow !== node.historyWindow)
        throw Error('已有其他资料更新待核对，未覆盖原提议');
      return this.output(s.id);
    }
    const p: ConversationContextProposal = {
      version: 1,
      id: uid(),
      sessionId: s.id,
      revision: s.revision + 1,
      base: s.context,
      proposed,
      historyWindow: node.historyWindow,
      sourceRunId,
    };
    s.contextProposalId = p.id;
    s.checkpointCurrent = false;
    check();
    this.commit(saved, () => this.immutable(kinds.proposal, p.id, p));
    return this.output(s.id);
  }
  proposal(id: string): ConversationContextProposal | null {
    const s = this.get(id).snapshot;
    if (!s.contextProposalId) return null;
    const p = this.store.get<ConversationContextProposal>(kinds.proposal, s.contextProposalId);
    validateConversationContextProposal(p, s);
    return structuredClone(p!);
  }
  adopt(id: string, revision: number, proposalId: string, accept: boolean) {
    this.deps.available();
    const saved = this.get(id, revision),
      s = saved.snapshot,
      p = this.proposal(id);
    if (!p || p.id !== proposalId || s.active || this.jobs.has(id))
      throw Error('资料更新身份已变化，请重新核对');
    s.contextProposalId = null;
    if (accept) {
      s.context = ref(p.proposed);
      s.title = p.proposed.title;
      s.flowId = p.proposed.flowId;
      s.nodeId = p.proposed.nodeId;
      s.historyWindow = p.historyWindow;
      saved.contextRevision = s.revision + 1;
      s.checkpointCurrent = false;
    } else this.refreshCheckpoint(saved);
    return this.commit(saved, () => {
      if (accept) this.immutable(kinds.context, p.proposed.id, p.proposed);
    });
  }
  private entry(id: string, ordinal: number): Entry {
    const e = this.store.get<Entry>(kinds.entry, key(id, ordinal));
    validateConversationEntry(e);
    if (!e || e.sessionId !== id || e.ordinal !== ordinal) throw Error('历史条目不属于本会话');
    return e;
  }
  archiveCapture(id: string, revision?: number) {
    const saved = this.get(id, revision);
    return conversationArchiveCapture(saved.snapshot, saved.contextRevision);
  }
  archiveEntry(id: string, ordinal: number) {
    if (ordinal > this.get(id).snapshot.historyCount) throw Error('来源请求超出真实历史范围');
    return structuredClone(this.entry(id, ordinal));
  }
  archiveContext(id: string, value: { id: string; sha256: string }) {
    this.get(id);
    const c = this.store.get<Context>(kinds.context, value.id);
    validateConversationContext(c);
    if (!c || !same(ref(c), value)) throw Error('来源资料引用与本机固定记录不一致');
    return structuredClone(c);
  }
  archiveCurrent(manifest: unknown) {
    const m = manifest as { capture: { sessionId: string } },
      saved = this.get(m.capture.sessionId);
    validateCurrentConversationArchive(manifest, saved.snapshot, saved.contextRevision);
    this.archiveContext(saved.snapshot.id, saved.snapshot.context);
    if (saved.snapshot.origin) this.origin(saved.snapshot.id);
  }
  archiveIsCurrent(manifest: unknown) {
    const m = manifest as { capture: { sessionId: string } },
      saved = this.get(m.capture.sessionId);
    // Missing/corrupt backing data is a failure, not a successful stale observation.
    this.archiveContext(saved.snapshot.id, saved.snapshot.context);
    if (saved.snapshot.origin) this.origin(saved.snapshot.id);
    try {
      validateCurrentConversationArchive(manifest, saved.snapshot, saved.contextRevision);
      return true;
    } catch {
      return false;
    }
  }
  private rows(id: string, selection: Selection): Entry[] {
    return selection.flatMap((r) => (r.kind === 'history' ? [this.entry(id, r.ordinal)] : []));
  }
  history(id: string, cursor: Cursor | null): ConversationHistoryPage {
    const s = this.get(id).snapshot;
    cursor ??= { sessionId: id, before: s.historyCount + 1, sha256: s.historyHash };
    if (
      cursor.sessionId !== id ||
      cursor.before > s.historyCount + 1 ||
      cursor.before < 1 ||
      !Number.isSafeInteger(cursor.before)
    )
      throw Error('历史游标不属于当前会话');
    const expected =
      cursor.before === 1
        ? conversationThreadSeed(id, s.origin)
        : this.entry(id, cursor.before - 1).sha256;
    if (cursor.sha256 !== expected) throw Error('历史游标摘要已失配，未跳过内容');
    const rows: Entry[] = [];
    let next: Cursor | null = null;
    for (let ordinal = cursor.before - 1; ordinal >= 1 && rows.length < 20; ordinal--) {
      const e = this.entry(id, ordinal),
        candidate = [e, ...rows];
      const after = ordinal > 1 ? { sessionId: id, before: ordinal, sha256: e.previousHash } : null;
      if (
        conversationBytes({ version: 1, cursor, entries: candidate, next: after }) >
        2 * 1024 * 1024
      )
        break;
      rows.unshift(e);
      next = after;
    }
    const value = { version: 1, cursor, entries: rows, next };
    validateConversationHistoryPage(value, s.origin);
    return value as ConversationHistoryPage;
  }
  selection(id: string): Selection {
    const saved = this.get(id),
      s = saved.snapshot,
      selected: Selection = [];
    let ordinal = saved.completeOrdinal;
    while (ordinal && selected.length < s.historyWindow) {
      const e = this.entry(id, ordinal),
        link = this.store.get<{ previous: number }>(kinds.complete, key(id, ordinal));
      if (
        e.state !== 'complete' ||
        !link ||
        !Number.isSafeInteger(link.previous) ||
        link.previous < 0 ||
        link.previous >= ordinal
      )
        throw Error('完整问答索引异常，未静默丢弃历史');
      selected.unshift({ kind: 'history', ordinal, sha256: e.sha256 });
      ordinal = link.previous;
    }
    if (selected.length < s.historyWindow && s.origin) {
      const o = this.origin(id)!;
      const old = o.attempts
        .filter(
          (a) =>
            a.state === 'complete' &&
            o.messages.some(
              (m) => m.role === 'assistant' && m.state === 'complete' && m.requestId === a.id,
            ),
        )
        .slice(-(s.historyWindow - selected.length))
        .map((a) => ({ kind: 'origin' as const, requestId: a.id }));
      selected.unshift(...old);
    }
    resolveConversationSelection(selected, s, this.origin(id), this.rows(id, selected));
    return selected;
  }
  private refreshCheckpoint(saved: Saved) {
    const s = saved.snapshot;
    s.checkpointCurrent = false;
    if (
      !s.latestCheckpoint ||
      s.active ||
      s.draft ||
      s.contextProposalId ||
      (s.lastEntry && s.lastEntry.state !== 'complete')
    )
      return;
    const c = this.checkpoint(s.id, s.latestCheckpoint.checkpointId);
    if (
      c.sourceRevision >= saved.contextRevision &&
      c.historyCount === s.historyCount &&
      c.historyHash === s.historyHash &&
      same(ref(c.context), s.context) &&
      c.selection.length <= s.historyWindow
    )
      s.checkpointCurrent = true;
  }
  draft(id: string, revision: number, text: string) {
    this.deps.available();
    const saved = this.get(id, revision);
    if (saved.snapshot.active || this.jobs.has(id)) throw Error('正在生成，未覆盖当前输入');
    saved.snapshot.draft = text;
    this.refreshCheckpoint(saved);
    return this.commit(saved);
  }
  private grant(value: SendGrant | CheckpointGrant) {
    for (const [token, item] of this.grants)
      if (item.expires <= Date.now()) this.grants.delete(token);
    if (this.grants.size >= 32) throw Error('打开的核对预览过多，请关闭旧预览后继续');
    const token = randomBytes(32).toString('hex');
    this.grants.set(token, value);
    return token;
  }
  private input(id: string, inputId: string): Prepared {
    const p = this.store.get<Prepared>(kinds.input, inputId);
    assertThreadPrepared(p);
    if (p.sessionId !== id || p.sha256 !== conversationPreparedHash(p))
      throw Error('固定发送快照不一致');
    return p;
  }
  async preview(
    id: string,
    revision: number,
    text: string,
    selection: Selection,
    retryOf: string | null,
  ): Promise<ThreadPreparedPreview> {
    this.deps.available();
    let saved = this.get(id, revision),
      s = saved.snapshot;
    if (s.active || s.contextProposalId || this.jobs.has(id))
      throw Error('请先完成本轮或核对资料更新');
    if (!text.trim() || text.length > 4000) throw Error('回复须为1–4000字符非空文本');
    if (retryOf && s.draft && s.draft !== text) throw Error('请先保留或处理新输入，再重试原轮次');
    if (s.draft !== text) {
      this.draft(id, revision, text);
      saved = this.get(id);
      s = saved.snapshot;
    }
    const c = this.context(id),
      origin = this.origin(id),
      rows = this.rows(id, selection);
    const items = resolveConversationSelection(selection, s, origin, rows);
    const messages: Prepared['input']['messages'] = [{ role: 'user', text }];
    messages.unshift(
      ...items.flatMap((e) => [
        { role: 'user' as const, text: e.text },
        { role: 'assistant' as const, text: e.answer },
      ]),
    );
    const p = {
      version: 1,
      id: uid(),
      sessionId: id,
      revision: s.revision,
      historyCount: s.historyCount,
      historyHash: s.historyHash,
      context: s.context,
      selection: structuredClone(selection),
      text,
      retryOf,
      input: {
        provider: c.provider,
        model: c.model,
        instructions: c.instructions,
        context: {
          value: c.context,
          history: {
            sessionId: id,
            count: s.historyCount,
            sha256: s.historyHash,
            origin: s.origin ? { ...s.origin } : null,
            selection: selection.map((r) => ({ ...r })),
          },
        },
        messages,
      },
      sha256: '',
    } satisfies Prepared;
    p.sha256 = conversationPreparedHash(p);
    validateConversationPrepared(p, s, c, origin, rows);
    const configuration = await this.deps.configuration(c.provider);
    this.deps.available();
    this.get(id, s.revision);
    if (!configuration.configured || !configuration.revision)
      throw Error('请配置自己的API Key；输入已保存，未调用模型');
    const expires = Date.now() + 300000;
    this.immutable(kinds.input, p.id, p);
    const token = this.grant({
      kind: 'send',
      sessionId: id,
      preparedId: p.id,
      hash: p.sha256,
      expires,
      configuration,
    });
    return { prepared: structuredClone(p), token, expiresAt: new Date(expires).toISOString() };
  }
  receipt(id: string, requestId: string): ThreadReceipt | null {
    this.get(id);
    const r = this.store.get<ThreadReceipt>(kinds.request, key(id, requestId));
    if (!r) return null;
    if (r.requestId !== requestId) throw Error('请求回执身份不一致');
    if (r.ordinal !== null) {
      const e = this.entry(id, r.ordinal);
      if (
        e.requestId !== requestId ||
        e.inputId !== r.preparedId ||
        e.inputHash !== r.preparedHash ||
        e.state !== r.state
      )
        throw Error('请求回执与固定历史不一致');
    }
    return structuredClone(r);
  }
  private sameRequest(r: ThreadReceipt, preparedId: string, hash: string) {
    if (r.preparedId !== preparedId || r.preparedHash !== hash)
      throw Error('请求身份已使用，不能更换内容重复发送');
  }
  withdraw(id: string, requestId: string, preparedId: string, hash: string): ThreadReceipt {
    this.deps.available();
    const p = this.input(id, preparedId);
    if (p.sha256 !== hash) throw Error('待核对请求摘要不一致');
    const old = this.receipt(id, requestId);
    if (old) {
      this.sameRequest(old, preparedId, hash);
      return old;
    }
    const r: ThreadReceipt = {
      requestId,
      preparedId,
      preparedHash: hash,
      state: 'withdrawn',
      ordinal: null,
    };
    this.immutable(kinds.request, key(id, requestId), r);
    return r;
  }
  async send(
    id: string,
    revision: number,
    requestId: string,
    preparedId: string,
    hash: string,
    token: string,
  ) {
    const prior = this.receipt(id, requestId);
    if (prior) {
      this.sameRequest(prior, preparedId, hash);
      return this.detail(id);
    }
    this.deps.available();
    const grant = this.grants.get(token);
    if (
      !grant ||
      grant.kind !== 'send' ||
      grant.sessionId !== id ||
      grant.preparedId !== preparedId ||
      grant.hash !== hash ||
      grant.expires <= Date.now()
    )
      throw Error('发送核对已过期，请重新核对；未调用模型');
    const p = this.input(id, preparedId),
      c = this.context(id);
    const configuration = await this.deps.configuration(c.provider);
    const repeated = this.receipt(id, requestId);
    if (repeated) {
      this.sameRequest(repeated, preparedId, hash);
      return this.detail(id);
    }
    this.deps.available();
    const saved = this.get(id, revision),
      s = saved.snapshot;
    if (
      grant.expires <= Date.now() ||
      this.grants.get(token) !== grant ||
      !configuration.configured ||
      configuration.revision !== grant.configuration.revision ||
      configuration.model !== grant.configuration.model
    )
      throw Error('Key或模型配置已变化，请重新核对；未调用模型');
    validateConversationPrepared(p, s, c, this.origin(id), this.rows(id, p.selection));
    if (p.sha256 !== hash || p.revision !== revision || s.draft !== p.text || this.jobs.has(id))
      throw Error('发送内容已变化，输入保留');
    const retry = p.retryOf !== null,
      previous = s.lastEntry;
    s.active = {
      requestId,
      turnId: retry ? previous!.turnId : uid(),
      userMessageId: retry ? previous!.userMessageId : uid(),
      assistantMessageId: uid(),
      text: p.text,
      answer: '',
      inputId: p.id,
      inputHash: p.sha256,
      context: p.context,
      retryOf: p.retryOf,
    };
    s.status = 'generating';
    s.requestCount++;
    if (!retry) s.turnCount++;
    s.draft = '';
    s.error = '';
    s.checkpointCurrent = false;
    const receipt: ThreadReceipt = {
      requestId,
      preparedId,
      preparedHash: hash,
      state: 'generating',
      ordinal: null,
    };
    this.deps.capacity.acquire('v2:' + id, requestId);
    let result: Head;
    try {
      result = this.commit(saved, () => {
        this.immutable(kinds.request, key(id, requestId), receipt);
        this.store.put(kinds.active, id, { id, requestId });
      });
    } catch (e) {
      this.deps.capacity.release('v2:' + id, requestId);
      throw e;
    }
    this.grants.delete(token);
    const job: Job = {
      id: requestId,
      provider: c.provider,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    this.jobs.set(id, job);
    job.done = this.perform(id, job, p, grant.configuration).finally(() => {
      if (this.jobs.get(id) === job) this.jobs.delete(id);
      this.deps.capacity.release('v2:' + id, requestId);
    });
    void job.done.catch(() => {});
    return result;
  }
  private finish(
    id: string,
    requestId: string,
    state: Entry['state'],
    error: string,
    reply?: ConversationReply,
  ) {
    const saved = this.get(id),
      s = saved.snapshot,
      a = s.active;
    if (!a || a.requestId !== requestId) return structuredClone(s);
    const old = this.receipt(id, requestId);
    if (!old || old.state !== 'generating') throw Error('请求终态没有对应准入回执');
    const input = this.input(id, a.inputId);
    if (input.sha256 !== a.inputHash || !same(input.context, a.context) || input.text !== a.text)
      throw Error('请求终态与原始发送内容不一致');
    const c = this.store.get<Context>(kinds.context, a.context.id);
    validateConversationContext(c);
    const e: Entry = {
      version: 1,
      sessionId: id,
      ordinal: s.historyCount + 1,
      previousHash: s.historyHash,
      sha256: '',
      ...a,
      state,
      model: reply?.model || c!.model,
      providerRequestId: reply?.requestId ?? '',
      usage: aiUsage(reply?.usage),
      finishedAt: now(),
      error,
    };
    e.sha256 = conversationEntryHash(e);
    validateConversationEntry(e);
    const previousComplete = saved.completeOrdinal;
    if (state === 'complete') saved.completeOrdinal = e.ordinal;
    s.historyCount = e.ordinal;
    s.historyHash = e.sha256;
    s.lastEntry = e;
    s.active = null;
    s.status = state === 'complete' ? 'ready' : state;
    s.error = error;
    s.checkpointCurrent = false;
    return this.commit(saved, () => {
      this.immutable(kinds.entry, key(id, e.ordinal), e);
      if (state === 'complete')
        this.immutable(kinds.complete, key(id, e.ordinal), { previous: previousComplete });
      this.store.put(kinds.request, key(id, requestId), { ...old, state, ordinal: e.ordinal });
      this.store.remove(kinds.active, id);
    });
  }
  cancel(id: string, requestId: string) {
    const s = this.get(id).snapshot,
      receipt = this.receipt(id, requestId);
    if (!receipt) throw Error('请求不属于本会话');
    if (receipt.state !== 'generating') return structuredClone(s);
    const job = this.jobs.get(id);
    if (s.active?.requestId !== requestId || job?.id !== requestId)
      throw Error('活动请求已变化，请重新读取');
    const result = this.finish(
      id,
      requestId,
      'cancelled',
      '本轮已取消，部分回复保留；未自动重试。',
    );
    job.abort.abort(Error('会话请求已取消'));
    return result;
  }
  private async perform(id: string, job: Job, p: Prepared, configuration: AIConfiguration) {
    const signal = AbortSignal.any([job.abort.signal, AbortSignal.timeout(120000)]);
    let keyValue = '',
      pending = '',
      lastFlush = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => {
      signal.throwIfAborted();
      this.deps.available();
      const saved = this.get(id);
      if (this.jobs.get(id) !== job || saved.snapshot.active?.requestId !== job.id)
        throw Error('当前请求已失效');
      return saved;
    };
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!pending) return;
      const saved = current();
      // Keep an unfinished surrogate in memory until the next chunk; persisted snapshots are valid Unicode.
      const ready = /[\uD800-\uDBFF]$/.test(pending) ? pending.slice(0, -1) : pending;
      if (!ready) return;
      saved.snapshot.active!.answer += ready;
      this.commit(saved, () => {}, false);
      pending = pending.slice(ready.length);
      lastFlush = Date.now();
    };
    try {
      current();
      keyValue = await abortable(
        () => this.deps.key(p.input.provider, configuration.revision!),
        signal,
      );
      current();
      const latest = await abortable(() => this.deps.configuration(p.input.provider), signal);
      current();
      if (
        !latest.configured ||
        latest.revision !== configuration.revision ||
        latest.model !== configuration.model
      )
        throw Error('Key或模型配置已变化，未调用模型');
      const reply = await abortable(
        () =>
          (this.deps.generate ?? streamConversation)(
            p.input as ConversationInput,
            keyValue,
            signal,
            (part) => {
              current();
              pending += part;
              if (pending.length >= 4096 || Date.now() - lastFlush >= 100) flush();
              else
                timer ??= setTimeout(() => {
                  try {
                    flush();
                  } catch (e) {
                    job.abort.abort(e);
                  }
                }, 100);
            },
          ),
        signal,
      );
      flush();
      if (pending || current().snapshot.active!.answer !== reply.text)
        throw Error('完整回复与持久化正文不一致');
      this.finish(id, job.id, 'complete', '', reply);
    } catch (e) {
      if (this.jobs.get(id) !== job || this.store.fault) return;
      const saved = this.get(id);
      if (saved.snapshot.active?.requestId !== job.id) return;
      if (pending) {
        const candidate = structuredClone(saved);
        candidate.snapshot.active!.answer += pending;
        let valid = false;
        try {
          validateConversationThread(candidate.snapshot);
          valid = true;
        } catch {
          /* Preserve the last valid partial. */
        }
        if (valid) this.commit(candidate, () => {}, false);
      }
      // Explicit cancellation already persisted its terminal state. Timer/format failures remain failures.
      this.finish(id, job.id, 'failed', redactedErrorText(e, [keyValue]).slice(0, 2000));
    } finally {
      clearTimeout(timer);
      keyValue = '';
    }
  }
  checkpoint(id: string, checkpointId: string): Checkpoint {
    const c = this.store.get<Checkpoint>(kinds.checkpoint, checkpointId);
    validateConversationCheckpoint(c);
    if (!c || c.sessionId !== id) throw Error('确认快照不属于本会话');
    return structuredClone(c);
  }
  private checkpointSource(id: string, selection: Selection): ThreadCheckpointSource {
    const s = this.get(id).snapshot,
      c = this.context(id);
    const items = resolveConversationSelection(
      selection,
      s,
      this.origin(id),
      this.rows(id, selection),
    );
    const source: ThreadCheckpointSource = {
      version: 1,
      sessionId: id,
      title: s.title,
      sourceRevision: s.revision,
      historyCount: s.historyCount,
      historyHash: s.historyHash,
      context: c,
      origin: s.origin,
      selection: structuredClone(selection),
      transcript: items.flatMap((e) => [
        { role: 'user', text: e.text, messageId: e.userMessageId, requestId: e.requestId },
        {
          role: 'assistant',
          text: e.answer,
          messageId: e.assistantMessageId,
          requestId: e.requestId,
        },
      ]),
    };
    const check = { ...source, id: 'preview-only', confirmedAt: now(), sha256: '' };
    check.sha256 = conversationCheckpointHash(check);
    validateCurrentConversationCheckpoint(
      check,
      s,
      c,
      this.origin(id),
      this.rows(id, selection),
      true,
    );
    return source;
  }
  checkpointPreview(id: string, revision: number, selection: Selection): ThreadCheckpointPreview {
    this.deps.available();
    this.get(id, revision);
    if (this.jobs.has(id)) throw Error('请求还在回收，请稍后核对');
    const source = this.checkpointSource(id, selection),
      hash = digest(source),
      expires = Date.now() + 300000;
    const token = this.grant({ kind: 'checkpoint', sessionId: id, source, hash, expires });
    return {
      source: structuredClone(source),
      token,
      sha256: hash,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  confirm(id: string, revision: number, requestId: string, token: string, hash: string) {
    const opKey = key(id, requestId),
      old = this.store.get<{ hash: string; checkpointId: string }>(kinds.confirmation, opKey);
    if (old) {
      if (old.hash !== hash) throw Error('确认请求身份已使用，不能更换内容');
      return { snapshot: this.detail(id), checkpoint: this.checkpoint(id, old.checkpointId) };
    }
    this.deps.available();
    const grant = this.grants.get(token),
      saved = this.get(id, revision),
      s = saved.snapshot;
    if (
      !grant ||
      grant.kind !== 'checkpoint' ||
      grant.sessionId !== id ||
      grant.hash !== hash ||
      grant.expires <= Date.now() ||
      this.jobs.has(id)
    )
      throw Error('确认核对已变化或过期，请重新核对；未固定新结果');
    const source = this.checkpointSource(id, grant.source.selection);
    if (!same(source, grant.source)) throw Error('确认内容已变化，输入保留');
    let c: Checkpoint | undefined;
    if (s.checkpointCurrent && s.latestCheckpoint) {
      const existing = this.checkpoint(id, s.latestCheckpoint.checkpointId);
      const {
        id: _id,
        confirmedAt: _time,
        sha256: _sha,
        sourceRevision: _rev,
        ...before
      } = existing;
      const { sourceRevision: _currentRevision, ...after } = source;
      if (same(before, after)) c = existing;
    }
    if (!c) {
      c = { ...source, id: uid(), confirmedAt: now(), sha256: '' };
      c.sha256 = conversationCheckpointHash(c);
      validateCurrentConversationCheckpoint(
        c,
        s,
        source.context,
        this.origin(id),
        this.rows(id, source.selection),
        true,
      );
      s.latestCheckpoint = conversationCheckpointEvidence(c);
      s.checkpointCurrent = true;
      this.commit(saved, () => {
        this.immutable(kinds.checkpoint, c!.id, c);
        this.immutable(kinds.confirmation, opKey, { hash, checkpointId: c!.id });
      });
    } else this.immutable(kinds.confirmation, opKey, { hash, checkpointId: c.id });
    this.grants.delete(token);
    return { snapshot: this.detail(id), checkpoint: structuredClone(c) };
  }
  verifyEvidence(value: unknown, current = true) {
    const e = value as { sessionId: string; checkpointId: string },
      saved = this.get(e.sessionId),
      s = saved.snapshot;
    const c = this.checkpoint(e.sessionId, e.checkpointId);
    verifyConversationCheckpointEvidence(value, c);
    if (current) {
      if (c.sourceRevision < saved.contextRevision)
        throw Error('来源设置已变化，请重新确认当前内容');
      validateCurrentConversationCheckpoint(
        c,
        s,
        this.context(s.id),
        this.origin(s.id),
        this.rows(s.id, c.selection),
      );
    }
  }
  output(id: string) {
    const s = this.get(id).snapshot;
    return conversationThreadOutput(
      s,
      s.checkpointCurrent && s.latestCheckpoint
        ? this.checkpoint(id, s.latestCheckpoint.checkpointId)
        : null,
    );
  }
  async cancelAll() {
    const jobs = [...this.jobs.entries()];
    for (const [id, job] of jobs) {
      try {
        this.cancel(id, job.id);
      } catch {
        job.abort.abort();
      }
    }
    await Promise.allSettled(jobs.map(([, job]) => job.done));
  }
}
