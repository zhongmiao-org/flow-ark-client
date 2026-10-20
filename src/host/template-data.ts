import type { Store } from './store';
import type { Bindings, FlowRecord, Run } from '../shared/types';
import type { AuthorCheckout, AuthorDraft } from '../shared/template-author';
import type {
  DataContext,
  DataState,
  DataOutput,
  DataReceipt,
  DataEdit,
  DataWriteRequest,
  ContextNode,
} from '../shared/template-data';
import type { PackageData, Entry } from '../../contracts/package-format';
import { jsonFile, validateData } from '../../contracts/package-format';
import {
  validateTemplateDataContext,
  validateTemplateDataState,
  validateTemplateDataWriteRequest,
  validateTemplateDataReceipt,
  validateTemplateDataOutput,
  validateTemplateDataEdit,
  validateTemplateDataEditResult,
  templateDataSchemaDigest,
} from '../../contracts/template-data';
import { schemaDefaults } from '../shared/template-config';
import { digest, uid, now, canonical } from '../shared/utils';
import { walk } from '../core/validate';

type Meta = { revision: number; updatedAt: string };
const maxRevision = Number.MAX_SAFE_INTEGER - 1;
/** Called in the same transaction as the actual state mutation. No second authority for values. */
function nextMeta(store: Store, kind: string, key: string): Meta {
  const old = store.get<Meta>(kind, key) ?? { revision: 0, updatedAt: now() };
  if (!Number.isSafeInteger(old.revision) || old.revision < 0 || old.revision >= maxRevision)
    throw Error('状态修订已达上限');
  return { revision: old.revision + 1, updatedAt: now() };
}
export function setInstanceState(store: Store, instanceId: string, value: unknown) {
  validateTemplateDataState({
    version: 1,
    contextId: instanceId,
    revision: 0,
    value,
    updatedAt: now(),
  });
  store.tx(() => {
    const next = nextMeta(store, 'template-state-meta', instanceId);
    store.put('template-state', instanceId, value);
    store.put('template-state-meta', instanceId, next);
  });
}
type Formal = { ref: NonNullable<Bindings['template']>; pkg: PackageData; entry: Entry };
type Deps = {
  available: () => void;
  formal: (record: FlowRecord) => Promise<Formal>;
  authorize: (record: FlowRecord, runId: string, signal: AbortSignal) => Promise<void>;
};
type Job = { runId: string; controller: AbortController };
export class TemplateData {
  private jobs = new Map<string, Job>();
  constructor(
    private store: Store,
    private deps: Deps,
  ) {}
  recover() {
    for (const op of this.store.list<{ runId: string; nodeInstance: string; receipt: DataReceipt }>(
      'template-data-operation',
    ))
      if (['prepared', 'unknown'].includes(op.receipt.status))
        this.store.attention(
          'unknown-result',
          '状态写入结果待核对',
          {
            runId: op.runId,
            operationId: op.receipt.operationId,
            reason: '运行曾中断；请在运行结果中核对原状态操作，不会自动重写',
          },
          'template-data:' + op.receipt.operationId,
        );
  }
  private operation(runId: string, nodeInstance: string) {
    return digest({ runId, nodeInstance });
  }
  /** The caller owns the checkout creation transaction. */
  createDebug(checkout: AuthorCheckout, draft: AuthorDraft) {
    const context: DataContext = {
      version: 1,
      id: uid(),
      owner: {
        kind: 'author-checkout',
        checkoutId: checkout.id,
        draftId: draft.id,
        draftRevision: checkout.baseRevision,
        entryId: checkout.entryId,
      },
      configurationRevision: 1,
      configurationSchema: structuredClone(draft.definition.configurationSchema),
      stateSchema: structuredClone(draft.definition.stateSchema),
      configuration: schemaDefaults(draft.definition.configurationSchema),
      schemaSha256: templateDataSchemaDigest(
        draft.definition.configurationSchema,
        draft.definition.stateSchema,
      ),
      createdAt: now(),
    };
    validateTemplateDataContext(context);
    this.store.put('author-debug-context', checkout.id, context);
    this.store.put('author-debug-state', checkout.id, schemaDefaults(context.stateSchema));
    this.store.put('author-debug-state-meta', checkout.id, { revision: 0, updatedAt: now() });
  }
  private debug(flowId: string) {
    const checkout = this.store
      .list<AuthorCheckout>('author-checkout')
      .find((c) => c.flowId === flowId);
    if (!checkout || !this.store.get<FlowRecord>('flow', flowId))
      throw Error('该流程不是已登记的制作副本');
    const context = this.store.get<DataContext>('author-debug-context', checkout.id);
    if (!context) throw Error('此副本尚无固定调试上下文，请从制作草稿创建新副本');
    validateTemplateDataContext(context);
    const o = context.owner;
    if (
      o.kind !== 'author-checkout' ||
      o.checkoutId !== checkout.id ||
      o.draftId !== checkout.draftId ||
      o.draftRevision !== checkout.baseRevision ||
      o.entryId !== checkout.entryId
    )
      throw Error('调试副本来源不一致');
    return { checkout, context };
  }
  private location(context: DataContext) {
    return context.owner.kind === 'instance'
      ? { kind: 'template-state', meta: 'template-state-meta', id: context.owner.instanceId }
      : {
          kind: 'author-debug-state',
          meta: 'author-debug-state-meta',
          id: context.owner.checkoutId,
        };
  }
  private readState(context: DataContext, ready = true): DataState {
    const p = this.location(context),
      meta = this.store.get<Meta>(p.meta, p.id);
    if (!meta) throw Error('状态修订登记不存在');
    const value = this.store.get(p.kind, p.id);
    if (value === undefined) throw Error('状态数据不存在');
    const state = {
      version: 1 as const,
      contextId: context.id,
      revision: meta.revision,
      value,
      updatedAt: meta.updatedAt,
    };
    validateTemplateDataState(state, ready ? context : undefined);
    return state;
  }
  debugGet(flowId: string) {
    const { checkout, context } = this.debug(flowId);
    return { checkout, context, state: this.readState(context, false) };
  }
  debugSave(input: unknown) {
    this.deps.available();
    const edit = validateTemplateDataEdit(input) as DataEdit,
      hash = digest(edit);
    const prior = this.store.get<{ hash: string; result: unknown }>(
      'template-data-edit',
      edit.requestId,
    );
    if (prior) {
      if (prior.hash !== hash) throw Error('调试保存请求身份已用于其他内容');
      return prior.result;
    }
    const checkout = this.store.get<AuthorCheckout>('author-checkout', edit.checkoutId);
    if (!checkout) throw Error('制作副本不存在');
    let result: any;
    this.store.tx(() => {
      const { context } = this.debug(checkout.flowId),
        state = this.readState(context, false);
      if (
        context.configurationRevision !== edit.expectedConfigurationRevision ||
        state.revision !== edit.expectedStateRevision
      )
        throw Error('调试配置或状态已变化，当前输入保留；请读取较新修订对照');
      validateData(context.configurationSchema, edit.configuration);
      validateData(context.stateSchema, edit.state);
      const changedConfig = canonical(context.configuration) !== canonical(edit.configuration),
        changedState = canonical(state.value) !== canonical(edit.state);
      if (changedConfig) {
        if (context.configurationRevision >= maxRevision) throw Error('配置修订已达上限');
        context.configurationRevision++;
        context.configuration = structuredClone(edit.configuration);
      }
      const next: DataState = changedState
        ? {
            ...state,
            revision: nextMeta(this.store, 'author-debug-state-meta', checkout.id).revision,
            value: structuredClone(edit.state),
            updatedAt: now(),
          }
        : state;
      result = { version: 1, requestId: edit.requestId, context, state: next };
      validateTemplateDataEditResult(result);
      this.deps.available();
      if (changedConfig) this.store.put('author-debug-context', checkout.id, context);
      if (changedState) {
        this.store.put('author-debug-state', checkout.id, next.value);
        this.store.put('author-debug-state-meta', checkout.id, {
          revision: next.revision,
          updatedAt: next.updatedAt,
        });
      }
      this.store.put('template-data-edit', edit.requestId, { hash, result });
    });
    return result;
  }
  private async formalContext(record: FlowRecord): Promise<DataContext> {
    const { ref, pkg } = await this.deps.formal(record),
      configurationSchema = jsonFile(pkg.files, pkg.manifest.configurationSchema),
      stateSchema = jsonFile(pkg.files, pkg.manifest.stateSchema),
      schemaSha256 = templateDataSchemaDigest(configurationSchema, stateSchema);
    const instance = this.store.get<any>('template-instance', ref.instanceId);
    if (!instance) throw Error('模板实例不存在');
    const rowKey = 'instance:' + ref.instanceId;
    let registered = this.store.get<{
      id: string;
      packageKey: string;
      digest: string;
      schemaSha256: string;
      createdAt: string;
    }>('template-data-context', rowKey);
    const values = record.bindings.configuration?.values;
    if (values === undefined) throw Error('固定配置缺失，请重新保存实例后检查');
    const configurationRevision =
      record.bindings.configuration?.revision ??
      (canonical(values) === canonical(instance.configuration)
        ? (instance.configurationRevision ?? 1)
        : undefined);
    if (configurationRevision === undefined || values === undefined)
      throw Error('固定配置缺少准确修订，请重新保存实例后检查');
    if (!registered) {
      registered = {
        id: uid(),
        packageKey: ref.packageKey,
        digest: ref.digest,
        schemaSha256,
        createdAt: now(),
      };
      this.store.tx(() => {
        this.store.put('template-data-context', rowKey, registered);
        if (!this.store.get('template-state-meta', ref.instanceId))
          this.store.put('template-state-meta', ref.instanceId, { revision: 0, updatedAt: now() });
      });
    }
    if (
      registered.packageKey !== ref.packageKey ||
      registered.digest !== ref.digest ||
      registered.schemaSha256 !== schemaSha256
    )
      throw Error('模板上下文来源或Schema已变化');
    return {
      version: 1,
      id: registered.id,
      owner: {
        kind: 'instance',
        instanceId: ref.instanceId,
        entryId: ref.entryId,
        package: {
          id: pkg.manifest.id,
          version: pkg.manifest.version,
          digest: pkg.manifest.contentDigest,
        },
      },
      configurationRevision,
      configurationSchema,
      stateSchema,
      configuration: structuredClone(values),
      schemaSha256,
      createdAt: registered.createdAt,
    };
  }
  /** Fresh configuration identity even when this entry has no context node. State is excluded. */
  async batchConfiguration(record: FlowRecord) {
    this.deps.available();
    if (!record.bindings.template) return structuredClone(this.debug(record.id).context);
    const context = await this.formalContext(record);
    const instance = this.store.get<any>('template-instance', record.bindings.template.instanceId);
    if (
      !instance ||
      (instance.configurationRevision ?? 1) !== context.configurationRevision ||
      canonical(instance.configuration) !== canonical(context.configuration)
    )
      throw Error('当前实例配置已变化，请重新保存入口后核对');
    return context;
  }
  async prepare(
    record: FlowRecord & { templateData?: DataContext },
  ): Promise<DataContext | undefined> {
    const nodes = walk(record.flow.steps).filter((n): n is ContextNode => n.type === 'context');
    if (!nodes.length) return;
    this.deps.available();
    const context =
      record.templateData ??
      (record.bindings.template ? await this.formalContext(record) : this.debug(record.id).context);
    validateTemplateDataContext(context, true);
    await this.current(context, record);
    this.readState(context);
    if (record.bindings.template) {
      const { entry } = await this.deps.formal(record);
      if (
        !entry.capabilities.includes('context') ||
        !entry.capabilities.includes('template-data-v1') ||
        (nodes.some((n) => n.operation !== 'configuration') &&
          !entry.capabilities.includes('state'))
      )
        throw Error('模板入口未声明配置与状态能力');
      if (nodes.some((n) => n.operation === 'state.write') && !entry.actions.length)
        throw Error('状态写入须声明独立写动作');
    }
    return structuredClone(context);
  }
  private async current(context: DataContext, record: FlowRecord) {
    if (context.owner.kind === 'author-checkout') {
      const { context: live } = this.debug(record.id);
      if (
        live.id !== context.id ||
        live.schemaSha256 !== context.schemaSha256 ||
        canonical(live.owner) !== canonical(context.owner)
      )
        throw Error('调试上下文身份已变化');
    } else {
      const { ref, pkg, entry } = await this.deps.formal(record),
        o = context.owner,
        row = this.store.get<any>('template-data-context', 'instance:' + ref.instanceId);
      if (
        o.instanceId !== ref.instanceId ||
        o.entryId !== entry.id ||
        o.package.id !== pkg.manifest.id ||
        o.package.version !== pkg.manifest.version ||
        o.package.digest !== ref.digest ||
        row?.id !== context.id ||
        row.schemaSha256 !== context.schemaSha256 ||
        templateDataSchemaDigest(
          jsonFile(pkg.files, pkg.manifest.configurationSchema),
          jsonFile(pkg.files, pkg.manifest.stateSchema),
        ) !== context.schemaSha256
      )
        throw Error('固定模板上下文与当前实例不一致');
    }
  }
  private assertGrants(record: FlowRecord, actions: string[], runId: string) {
    const id = record.bindings.template?.instanceId;
    if (!id) return;
    const live = this.store.get<any>('template-instance', id);
    if (!live) throw Error('模板实例不存在');
    for (const action of actions) {
      const grant = live.grants[action];
      if (grant === 'auto') continue;
      if (grant === 'confirm' && this.store.get('template-approval', runId + ':' + action))
        continue;
      throw Error('状态写入授权已撤销或尚未确认：' + action);
    }
  }
  cancel(runId: string, nodeInstance: string) {
    if (typeof nodeInstance !== 'string' || !nodeInstance || nodeInstance.length > 2048)
      throw Error('节点实例身份无效');
    const id = this.operation(runId, nodeInstance);
    this.jobs.get(id)?.controller.abort(new Error('状态节点已撤销'));
    this.store.put('template-data-cancelled', id, { runId, nodeInstance });
    return true;
  }
  async perform(
    record: FlowRecord & { templateData?: DataContext },
    runId: string,
    node: ContextNode,
    nodeInstance: string,
    resolved: any,
    signal: AbortSignal,
    active: () => void,
  ): Promise<DataOutput> {
    const context = record.templateData;
    if (!context) throw Error('运行没有固定配置与状态上下文');
    const operationId = this.operation(runId, nodeInstance),
      controller = new AbortController();
    if (this.jobs.has(operationId)) throw Error('同一状态操作正在处理，请核对原回执');
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const check = () => {
      this.deps.available();
      active();
      controller.signal.throwIfAborted();
      if (this.store.get('template-data-cancelled', operationId)) throw Error('该状态操作已撤销');
    };
    this.jobs.set(operationId, { runId, controller });
    try {
      this.deps.available();
      active();
      await this.current(context, record);
      this.deps.available();
      active();
      validateTemplateDataContext(context, true);
      if (node.operation !== 'state.write') {
        check();
        const state = node.operation === 'state.read' ? this.readState(context) : null;
        const out = {
          version: 1,
          operation: node.operation,
          contextId: context.id,
          revision: state ? state.revision : context.configurationRevision,
          value: state ? state.value : context.configuration,
        };
        validateTemplateDataOutput(out);
        return out as DataOutput;
      }
      const request: DataWriteRequest = {
        version: 1,
        contextId: context.id,
        operationId,
        runId,
        nodeInstance,
        expectedRevision: resolved.expectedRevision,
        value: resolved.value,
      };
      validateTemplateDataWriteRequest(request, context);
      const requestSha256 = digest(request);
      const old = this.store.get<{ runId: string; nodeInstance: string; receipt: DataReceipt }>(
        'template-data-operation',
        operationId,
      );
      if (old) {
        validateTemplateDataReceipt(old.receipt, request);
        if (old.receipt.status === 'written') return old.receipt.result;
        throw Error('原状态操作已有记录，请核对原回执，不自动重试');
      }
      check();
      let actions: string[] = [];
      if (record.bindings.template) {
        const { entry } = await this.deps.formal(record);
        actions = entry.actions;
        await this.deps.authorize(record, runId, controller.signal);
        await this.current(context, record);
      }
      check();
      this.assertGrants(record, actions, runId);
      let receipt: DataReceipt = {
        version: 1,
        contextId: context.id,
        operationId,
        requestSha256,
        status: 'prepared',
        createdAt: now(),
        updatedAt: now(),
      };
      const persist = (value: DataReceipt) => {
        validateTemplateDataReceipt(value, request);
        this.store.put('template-data-operation', operationId, {
          runId,
          nodeInstance,
          receipt: value,
        });
      };
      persist(receipt);
      try {
        receipt = this.store.tx(() => {
          check();
          this.assertGrants(record, actions, runId);
          const current = this.readState(context);
          if (current.revision !== request.expectedRevision) {
            const conflict = {
              ...receipt,
              status: 'conflict' as const,
              currentRevision: current.revision,
              updatedAt: now(),
              error: '状态修订已变化；保留原输入并读取最新状态',
            };
            persist(conflict);
            return conflict;
          }
          const at = now(),
            result = {
              version: 1 as const,
              operation: 'state.write' as const,
              contextId: context.id,
              operationId,
              previousRevision: current.revision,
              revision: current.revision + 1,
              value: structuredClone(request.value),
              committedAt: at,
            };
          validateTemplateDataOutput(result);
          const target = this.location(context);
          this.store.put(target.kind, target.id, result.value);
          this.store.put(target.meta, target.id, { revision: result.revision, updatedAt: at });
          const written = { ...receipt, status: 'written' as const, updatedAt: at, result };
          persist(written);
          return written;
        });
      } catch (e) {
        if (!this.store.fault) {
          const latest = this.store.get<any>('template-data-operation', operationId)?.receipt;
          if (latest?.status === 'written') return latest.result;
          receipt = {
            ...receipt,
            status:
              controller.signal.aborted || this.store.get('template-data-cancelled', operationId)
                ? 'cancelled'
                : 'unknown',
            updatedAt: now(),
            error: '状态提交未确认，请核对原操作；不会自动重写',
          };
          persist(receipt);
        }
        throw e;
      }
      if (receipt.status === 'written') return receipt.result;
      throw Error(
        '状态修订冲突：当前修订' +
          ('currentRevision' in receipt ? receipt.currentRevision : '未知') +
          '；原状态未被此操作覆盖',
      );
    } finally {
      signal.removeEventListener('abort', abort);
      this.jobs.delete(operationId);
    }
  }
  operations(runId: string) {
    if (!this.store.get<Run>('run', runId)) throw Error('运行记录不存在');
    return this.store
      .list<{ runId: string; nodeInstance: string; receipt: DataReceipt }>(
        'template-data-operation',
      )
      .filter((o) => o.runId === runId)
      .map((o) => ({ nodeInstance: o.nodeInstance, receipt: o.receipt }));
  }
  async inspect(runId: string, operationId: string) {
    if (!this.store.get<Run>('run', runId)) throw Error('运行记录不存在');
    const op = this.store.get<{ runId: string; nodeInstance: string; receipt: DataReceipt }>(
      'template-data-operation',
      operationId,
    );
    if (!op || op.runId !== runId) throw Error('状态操作不属于该运行');
    validateTemplateDataReceipt(op.receipt);
    if (this.store.fault) {
      const { contextId, operationId, requestSha256, createdAt, updatedAt } = op.receipt;
      return {
        version: 1,
        contextId,
        operationId,
        requestSha256,
        createdAt,
        updatedAt,
        status: 'unknown',
        error: '存储故障，请重开后核对原操作',
      };
    }
    if (this.jobs.has(operationId) || !['prepared', 'unknown'].includes(op.receipt.status))
      return op.receipt;
    const snapshot = this.store.get<FlowRecord & { templateData?: DataContext }>('snapshot', runId);
    if (!snapshot?.templateData || snapshot.templateData.id !== op.receipt.contextId)
      throw Error('固定上下文缺失，保留原待核对记录');
    await this.current(snapshot.templateData, snapshot);
    this.readState(snapshot.templateData);
    // A healthy, quiescent database has no committed transaction without its written receipt.
    if (this.jobs.has(operationId)) return op.receipt;
    const latest = this.store.get<typeof op>('template-data-operation', operationId)!;
    if (latest.receipt.status === 'written') return latest.receipt;
    latest.receipt = {
      ...latest.receipt,
      status: 'cancelled',
      updatedAt: now(),
      error: '原操作没有事务提交记录，未重写；需要时基于最新状态另起运行',
    };
    this.store.put('template-data-operation', operationId, latest);
    return latest.receipt;
  }
  release(runId: string) {
    for (const job of this.jobs.values())
      if (job.runId === runId) job.controller.abort(new Error('运行已结束'));
  }
}
