import type { Store } from './store';
import type { FlowRecord, PreparedScripts, Run } from '../shared/types';
import type { AuthorCheckout, AuthorDraft } from '../shared/template-author';
import type {
  TemplateAuthorSdkContext,
  TemplateAuthorSdkResult,
} from '../shared/contracts.generated';
import {
  authorSdkDefinitionDigest,
  validateAuthorSdkContext,
  validateAuthorSdkResult,
  assertAuthorSdkOperation,
} from '../../contracts/author-sdk';
import { canonical } from '../../contracts/package-format';
import { validateObject, walk } from '../core/validate';
import { now, uid } from '../shared/utils';

type Snapshot = FlowRecord & Partial<PreparedScripts>;
const missing =
  '此旧副本没有固定SDK上下文。请核对带回、保存制作修订后创建新的编排副本；原编排和记录保留。';
/** Host-owned, author-local result and attention operations. Never impersonates an instance. */
export class AuthorSdk {
  constructor(
    private store: Store,
    private available: () => void,
    private notify: () => Promise<unknown>,
  ) {}
  create(checkout: AuthorCheckout, draft: AuthorDraft) {
    const entry = draft.definition.entries.find((e) => e.id === checkout.entryId);
    if (!entry || checkout.draftId !== draft.id || checkout.baseRevision !== draft.revision)
      throw Error('作者SDK创建来源不一致');
    const context = {
      version: 1 as const,
      id: uid(),
      owner: {
        kind: 'author-checkout' as const,
        checkoutId: checkout.id,
        draftId: checkout.draftId,
        entryId: checkout.entryId,
        flowId: checkout.flowId,
        baseRevision: checkout.baseRevision,
      },
      resultSchema: structuredClone(entry.resultSchema),
      capabilities: [...new Set([...entry.flow.requiredCapabilities, ...entry.capabilities])],
      definitionSha256: '',
      createdAt: now(),
    };
    context.definitionSha256 = authorSdkDefinitionDigest(context);
    validateAuthorSdkContext(context);
    this.store.put('author-sdk-context', checkout.id, context);
  }
  private checkout(flowId: string) {
    const matches = this.store
      .list<AuthorCheckout>('author-checkout')
      .filter((c) => c.flowId === flowId);
    if (matches.length > 1) throw Error('编排副本来源不唯一');
    const checkout = matches[0];
    if (checkout) validateObject('TemplateAuthorCheckout', checkout);
    return checkout;
  }
  prepare(record: Snapshot): TemplateAuthorSdkContext | undefined {
    const checkout = this.checkout(record.id);
    if (!checkout) {
      if (record.authorSdk) throw Error('作者SDK上下文没有真实副本登记');
      return;
    }
    if (
      record.bindings.template ||
      record.flow.id !== record.id ||
      !this.store.get<FlowRecord>('flow', record.id)
    )
      throw Error('作者SDK副本身份不一致');
    const fixed = this.store.get<TemplateAuthorSdkContext>('author-sdk-context', checkout.id);
    if (!fixed) {
      if (record.authorSdk || walk(record.flow.steps).some((n) => n.type === 'script'))
        throw Error(missing);
      return;
    }
    validateAuthorSdkContext(fixed);
    const owner = fixed.owner;
    if (
      owner.checkoutId !== checkout.id ||
      owner.draftId !== checkout.draftId ||
      owner.entryId !== checkout.entryId ||
      owner.flowId !== record.id ||
      owner.baseRevision !== checkout.baseRevision
    )
      throw Error('作者SDK固定来源与登记不符');
    if (record.authorSdk && canonical(record.authorSdk) !== canonical(fixed))
      throw Error('作者SDK快照与固定登记不符');
    return structuredClone(fixed);
  }
  describe(record: Snapshot) {
    try {
      return { sdk: this.prepare(record) };
    } catch (error) {
      return { sdkError: error instanceof Error ? error.message : '固定SDK来源不可用' };
    }
  }
  private running(record: Snapshot, runId: string, signal: AbortSignal, active: () => void) {
    this.available();
    active();
    signal.throwIfAborted();
    const context = this.prepare(record),
      run = this.store.get<Run>('run', runId);
    const snapshot = this.store.get<Snapshot>('snapshot', runId);
    if (
      !context ||
      !record.authorSdk ||
      run?.state !== 'RUNNING' ||
      run.flowId !== record.id ||
      !snapshot?.authorSdk ||
      canonical(snapshot.authorSdk) !== canonical(context)
    )
      throw Error('作者SDK请求不属于当前活动Run的固定上下文');
    return context;
  }
  private saveResult(context: TemplateAuthorSdkContext, runId: string, value: unknown) {
    const result = {
      version: 1,
      runId,
      contextId: context.id,
      definitionSha256: context.definitionSha256,
      value,
      createdAt: now(),
    };
    validateAuthorSdkResult(result, context, runId);
    this.store.put('author-sdk-result', runId, result);
    return structuredClone(value);
  }
  call(record: Snapshot, runId: string, args: any, signal: AbortSignal, active: () => void) {
    const context = this.running(record, runId, signal, active);
    assertAuthorSdkOperation(context, args?.operation);
    if (args.operation === 'result') {
      return this.store.tx(() => {
        this.running(record, runId, signal, active);
        return this.saveResult(context, runId, args.value);
      });
    }
    const request = args.request;
    if (!request || typeof request.title !== 'string' || typeof request.key !== 'string')
      throw Error('作者调试提醒参数无效');
    const origin = {
      version: 2 as const,
      runId,
      checkoutId: context.owner.checkoutId,
      draftId: context.owner.draftId,
      entryId: context.owner.entryId,
      baseRevision: context.owner.baseRevision,
    };
    const dedupeKey = 'author-sdk-attention:' + context.owner.checkoutId + ':' + request.key;
    const detail = request.detail === undefined ? {} : request.detail;
    // Check bounded finite JSON before recursive schema validation or any persistence.
    let count = 0;
    const visit = (value: any, depth = 0) => {
      if (++count > 50000 || depth > 40) throw Error('作者提醒内容层级或数量超限');
      if (
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
        return;
      if (typeof value === 'string' && Buffer.from(value).toString('utf8') === value) return;
      if (
        !value ||
        typeof value !== 'object' ||
        (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      )
        throw Error('作者提醒仅接受有限JSON');
      if (Array.isArray(value)) for (const v of value) visit(v, depth + 1);
      else
        for (const [key, v] of Object.entries(value)) {
          visit(key, depth + 1);
          visit(v, depth + 1);
        }
    };
    const candidate = {
      id: uid(),
      kind: 'template',
      title: request.title,
      detail,
      dedupeKey,
      read: false,
      time: now(),
      origin,
    };
    visit(candidate);
    if (Buffer.byteLength(JSON.stringify(candidate)) > 2 * 1048576) throw Error('作者提醒超过2MiB');
    validateObject('TemplateAttentionRecord', candidate);
    const item = this.store.tx(() => {
      this.running(record, runId, signal, active);
      return this.store.attention('template', request.title, detail, dedupeKey, origin);
    });
    void this.notify().catch(() => {});
    return item;
  }
  complete(
    record: Snapshot,
    runId: string,
    output: unknown,
    signal: AbortSignal,
    active: () => void,
  ) {
    if (!record.authorSdk) return;
    const context = this.running(record, runId, signal, active);
    const result = this.store.get<TemplateAuthorSdkResult>('author-sdk-result', runId);
    if (result) {
      validateAuthorSdkResult(result, context, runId);
      return;
    }
    this.store.tx(() => {
      this.running(record, runId, signal, active);
      this.saveResult(context, runId, output);
    });
  }
  read(runId: string) {
    const run = this.store.get<Run>('run', runId),
      snapshot = this.store.get<Snapshot>('snapshot', runId);
    if (!run || !snapshot?.authorSdk || run.flowId !== snapshot.id)
      throw Error('此运行没有固定作者SDK来源');
    const context = this.prepare(snapshot)!;
    const result = this.store.get<TemplateAuthorSdkResult>('author-sdk-result', runId);
    if (!result) throw Error('此Run尚无已保存的作者SDK结果；不会重新执行');
    validateAuthorSdkResult(result, context, runId);
    return structuredClone(result);
  }
}
