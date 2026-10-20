import { assertBrowserScrollInvocation, assertBrowserScrollResult } from '../shared/browser-scroll';
import type { BrowserScrollInvocation } from '../shared/contracts.generated';
import { assertBrowserTargetResult } from '../shared/browser-target';
import { verifyRead, verifyPrepared } from '../../contracts/run-result-binding.mjs';
import { realpathSync, statSync } from 'node:fs';
import type { Store } from './store';
import { validateConversationOutput } from '../../contracts/skill-trial';
import type { FlowRecord, Run, PreparedScripts } from '../shared/types';
import { assertDocumentResult } from '../shared/document';
import { assertSkillVersion, skillBytes } from '../shared/skill';
import { digest } from '../shared/utils';
import { walk, validateObject } from '../core/validate';
import { validateTemplateDataOutput } from '../../contracts/template-data';
import type { DataOutput, DataReceipt } from '../shared/template-data';
import { contextOperations } from '../shared/template-data';
import { assertBrowserInspectionResult } from '../shared/browser-inspection';
import {
  assertBrowserFieldsInvocation,
  assertBrowserFieldsResult,
  type ResolvedBrowserFieldsNode,
} from '../shared/browser-fields';
import { assertThreadOutput } from '../shared/conversation-thread';
import {
  validateConversationCheckpoint,
  verifyConversationCheckpointEvidence,
} from '../../contracts/continuous-conversation';
import type { ConversationCheckpoint } from '../shared/conversation-thread';
import type { SourceNode } from '../shared/conversation-source';
import type { ReductionTarget } from '../shared/source-reduction';
import { assertEffectResult, effectOperations } from '../shared/effect-node';
import { sha256 as effectId } from '../../contracts/package-format';
export type TypedResultMeta = {
  id: string;
  nodeId: string;
  nodeInstance: string;
  type:
    | 'document'
    | 'skill'
    | 'context'
    | 'conversation'
    | 'browser'
    | 'run-result'
    | 'source'
    | 'source-reduce'
    | 'effect';
  label: string;
  bytes: number;
  sha256: string;
};
export class TypedResults {
  constructor(
    private store: Store,
    private sourceResult?: (record: FlowRecord, node: SourceNode, value: unknown) => void,
    private reductionResult?: (target: ReductionTarget, value: unknown) => void,
  ) {}
  save(
    runId: string,
    nodeId: string,
    nodeInstance: string,
    type: TypedResultMeta['type'],
    value: unknown,
    browserInput?: ResolvedBrowserFieldsNode | BrowserScrollInvocation,
  ) {
    if (typeof nodeInstance !== 'string' || !nodeInstance || nodeInstance.length > 4000)
      throw Error('结构化结果步骤身份无效');
    const snapshot = this.store.get<FlowRecord>('snapshot', runId);
    const node = snapshot && walk(snapshot.flow.steps).find((n) => n.id === nodeId);
    if (!node || node.type !== type) throw Error('结构化结果不属于当前快照');
    if (type === 'run-result') this.checkResult(runId, nodeId, value);
    else if (type === 'effect') this.effectResult(runId, nodeId, value);
    else if (type === 'source-reduce') this.checkReduction(runId, nodeId, nodeInstance, value);
    else if (type === 'source') this.checkSource(snapshot!, nodeId, value);
    else if (type === 'document') assertDocumentResult(value);
    else if (type === 'skill') assertSkillVersion(value);
    else if (type === 'conversation') this.conversationResult(value, node.version);
    else if (type === 'browser')
      this.browserResult(runId, nodeId, nodeInstance, value, browserInput);
    else this.contextResult(runId, nodeInstance, value);
    const id = digest({ runId, nodeId, nodeInstance, type }),
      sha256 = digest(value),
      bytes = skillBytes(value);
    const entries = this.list(runId),
      old = entries.find((e) => e.id === id);
    if (old) {
      if (old.sha256 !== sha256) throw Error('同一步骤结果身份已使用');
      return;
    }
    if (
      entries.length >= 1000 ||
      entries.reduce((sum, e) => sum + e.bytes, 0) + bytes > 8 * 1048576
    )
      throw Error('本次结构化结果超过1000项或8MiB，未截断采用');
    const meta: TypedResultMeta = {
      id,
      nodeId,
      nodeInstance,
      type,
      label:
        typeof node.name === 'string' && node.name.trim()
          ? node.name
          : node.type === 'effect'
            ? effectOperations[node.operation]
            : node.type === 'context'
              ? contextOperations[node.operation]
              : node.id,
      bytes,
      sha256,
    };
    this.store.tx(() => {
      if (browserInput?.version === 12) {
        this.store.put('browser-scroll-input', digest({ runId, nodeId, nodeInstance }), {
          node: browserInput,
          sha256,
        });
      } else if (browserInput) {
        if (
          type !== 'browser' ||
          node.type !== 'browser' ||
          ![5, 6, 7, 9, 10, 11].includes(node.version)
        )
          throw Error('关联字段配置只能登记到对应节点');
        this.store.put('browser-fields-input', digest({ runId, nodeId, nodeInstance }), {
          node: browserInput,
          sha256,
        });
      }
      this.store.put('typed-run-result', id, { runId, meta, value });
      if (type === 'document') {
        const source = (value as import('../shared/document').DocumentResult).source;
        if (node.type !== 'document' || source.binding !== node.binding)
          throw Error('资料来源与固定节点不一致');
        const root = realpathSync(snapshot!.bindings.files[source.binding]),
          stat = statSync(root, { bigint: true });
        if (!stat.isDirectory()) throw Error('资料目录不可用');
        const pointer = { id, root: { path: root, dev: String(stat.dev), ino: String(stat.ino) } };
        this.store.put('document-source-proof', digest({ runId, source }), pointer);
        this.store.put('document-source-proof', digest({ source }), pointer);
      }
      this.store.put('typed-run-index', runId, { entries: [...entries, meta] });
    });
  }
  private effectResult(runId: string, nodeId: string, value: unknown) {
    assertEffectResult(value);
    const snapshot = this.store.get<FlowRecord>('snapshot', runId);
    const node = snapshot && walk(snapshot.flow.steps).find((n) => n.id === nodeId);
    const ref = snapshot?.bindings.template;
    const record = this.store.get<any>('template-effect', value.id);
    if (
      !ref ||
      node?.type !== 'effect' ||
      node.operation !== value.operation ||
      !record ||
      record.instanceId !== ref.instanceId ||
      value.id !== effectId(ref.instanceId + ':' + record.action + ':' + record.key)
    )
      throw Error('操作记录结果与原运行不一致');
    if (value.operation === 'prepare') {
      if (
        node.operation !== 'prepare' ||
        value.action !== node.action ||
        record.action !== value.action ||
        record.key !== value.key ||
        record.runId !== value.runId ||
        (value.execute && value.runId !== runId)
      )
        throw Error('准备回执与实际账本不一致');
    } else if (
      node.operation !== 'resolve' ||
      value.state !== node.state ||
      record.runId !== runId ||
      record.state !== value.state
    )
      throw Error('登记回执与实际账本不一致');
    // Prepared receipts are immutable historical facts; the ledger may since have become terminal.
  }
  list(runId: string): TypedResultMeta[] {
    return this.store.get<{ entries: TypedResultMeta[] }>('typed-run-index', runId)?.entries ?? [];
  }
  read(runId: string, id: string) {
    const run = this.store.get<Run>('run', runId),
      r = this.store.get<{ runId: string; meta: TypedResultMeta; value: unknown }>(
        'typed-run-result',
        id,
      );
    if (
      !run ||
      (!['context', 'source-reduce', 'effect'].includes(r?.meta.type ?? '') &&
        run.state !== 'SUCCEEDED') ||
      !r ||
      r.runId !== runId ||
      !this.list(runId).some((e) => e.id === id)
    )
      throw Error('完整结构化结果尚不可采用');
    if (digest(r.value) !== r.meta.sha256) throw Error('结构化结果摘要不一致');
    if (r.meta.type === 'run-result') this.checkResult(runId, r.meta.nodeId, r.value);
    else if (r.meta.type === 'effect') this.effectResult(runId, r.meta.nodeId, r.value);
    else if (r.meta.type === 'source-reduce')
      this.checkReduction(runId, r.meta.nodeId, r.meta.nodeInstance, r.value);
    else if (r.meta.type === 'source')
      this.checkSource(this.store.get<FlowRecord>('snapshot', runId)!, r.meta.nodeId, r.value);
    else if (r.meta.type === 'document') assertDocumentResult(r.value);
    else if (r.meta.type === 'context') this.contextResult(runId, r.meta.nodeInstance, r.value);
    else if (r.meta.type === 'conversation') {
      const snapshot = this.store.get<FlowRecord>('snapshot', runId);
      const node = snapshot && walk(snapshot.flow.steps).find((n) => n.id === r.meta.nodeId);
      if (node?.type !== 'conversation') throw Error('会话结果不属于固定节点');
      this.conversationResult(r.value, node.version);
    } else if (r.meta.type === 'browser')
      this.browserResult(runId, r.meta.nodeId, r.meta.nodeInstance, r.value);
    else {
      assertSkillVersion(r.value);
      const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', runId);
      if (digest(snapshot?.skillSnapshots?.[r.meta.nodeId]) !== digest(r.value))
        throw Error('Skill结果与运行快照不一致');
    }
    return {
      type: r.meta.type,
      value: r.value,
      nodeInstance: r.meta.nodeInstance,
      ...(r.meta.type === 'browser'
        ? { operation: this.browserResult(runId, r.meta.nodeId, r.meta.nodeInstance, r.value) }
        : {}),
      ...(['source', 'source-reduce'].includes(r.meta.type) ? { nodeId: r.meta.nodeId } : {}),
    };
  }
  private checkResult(runId: string, nodeId: string, value: unknown) {
    const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', runId);
    const node = snapshot && walk(snapshot.flow.steps).find((n) => n.id === nodeId);
    if (node?.type !== 'run-result') throw Error('结果读取不属于固定节点');
    const fixed = snapshot?.resultSources?.[node.binding];
    if (!fixed) throw Error('结果读取没有固定来源');
    verifyPrepared({ [node.binding]: fixed }, runId);
    const v = validateObject<import('../shared/contracts.generated').RunResultRead>(
      'RunResultRead',
      value,
    );
    if (v.binding !== node.binding || digest(v.ref) !== digest(fixed.ref))
      throw Error('读取结果与固定来源不一致');
    verifyRead(v, fixed.owner, {
      id: node.binding,
      kind: 'run-result',
      access: 'read',
      required: true,
      name: node.binding,
      sourceEntries: [fixed.ref.source.entryId],
    });
  }
  private checkSource(record: FlowRecord, nodeId: string, value: unknown) {
    const node = record && walk(record.flow.steps).find((n) => n.id === nodeId);
    if (node?.type !== 'source' || !this.sourceResult) throw Error('来源结果不属于固定运行节点');
    this.sourceResult(record, node, value);
  }
  private checkReduction(runId: string, nodeId: string, nodeInstance: string, value: unknown) {
    if (!this.reductionResult) throw Error('整理结果登记核对不可用');
    this.reductionResult({ runId, nodeId, nodeInstance }, value);
  }
  private browserResult(
    runId: string,
    nodeId: string,
    nodeInstance: string,
    value: unknown,
    input?: ResolvedBrowserFieldsNode | BrowserScrollInvocation,
  ) {
    const snapshot = this.store.get<FlowRecord>('snapshot', runId);
    const node = snapshot && walk(snapshot.flow.steps).find((n) => n.id === nodeId);
    if (!node || node.type !== 'browser' || ![4, 5, 6, 7, 8, 9, 10, 11, 12].includes(node.version))
      throw Error('网页只读结果不属于固定节点');
    if (node.version === 12) {
      const saved = this.store.get<{ node: BrowserScrollInvocation; sha256: string }>(
        'browser-scroll-input',
        digest({ runId, nodeId, nodeInstance }),
      );
      if (
        saved &&
        (saved.sha256 !== digest(value) || (input && digest(saved.node) !== digest(input)))
      )
        throw Error('滚动调用来源或回执摘要不一致');
      const resolved = assertBrowserScrollInvocation(node, input ?? saved?.node);
      if (resolved.nodeInstance !== nodeInstance) throw Error('滚动结果步骤身份不一致');
      assertBrowserScrollResult(resolved, value);
      return 'scroll';
    }
    if (
      node.version === 5 ||
      node.version === 6 ||
      node.version === 7 ||
      node.version === 9 ||
      node.version === 10 ||
      node.version === 11
    ) {
      const saved = this.store.get<{ node: ResolvedBrowserFieldsNode; sha256: string }>(
        'browser-fields-input',
        digest({ runId, nodeId, nodeInstance }),
      );
      if (
        saved &&
        (saved.sha256 !== digest(value) || (input && digest(saved.node) !== digest(input)))
      )
        throw Error('关联采集的原配置或摘要不一致');
      const resolved = assertBrowserFieldsInvocation(node, input ?? saved?.node);
      assertBrowserFieldsResult(resolved, value);
      return 'collect';
    }
    if (node.version === 8) {
      assertBrowserTargetResult(node.operation, value);
      return node.operation;
    }
    assertBrowserInspectionResult(node.operation, value);
    return node.operation;
  }
  private conversationResult(value: unknown, version: number) {
    if (version === 2) {
      assertThreadOutput(value);
      if (value.status !== 'confirmed') {
        if (
          value.evidence ||
          value.transcript.length ||
          (value.status === 'context-review') !== !!value.proposalId
        )
          throw Error('未确认的持续会话输出不能携带可采用历史');
        return;
      }
      if (!value.evidence || value.proposalId) throw Error('确认结果缺少固定来源');
      const c = this.store.get<ConversationCheckpoint>(
        'conversation-thread-checkpoint',
        value.evidence.checkpointId,
      );
      validateConversationCheckpoint(c);
      verifyConversationCheckpointEvidence(value.evidence, c);
      if (
        !c ||
        c.sessionId !== value.sessionId ||
        c.sourceRevision > value.revision ||
        c.historyCount !== value.historyCount ||
        c.historyHash !== value.historyHash ||
        digest({ id: c.context.id, sha256: c.context.sha256 }) !== digest(value.context) ||
        digest(c.origin) !== digest(value.origin) ||
        digest(c.transcript) !== digest(value.transcript)
      )
        throw Error('持续会话结果与当时的固定来源不一致');
      return;
    }
    const v = validateConversationOutput(value);
    if (v.evidence) {
      const saved = this.store.get<{ snapshot: unknown }>('guided-conversation', v.sessionId);
      if (!saved) throw Error('会话来源记录缺失，完整输出未核验');
      validateConversationOutput(value, saved.snapshot);
    }
  }
  private contextResult(runId: string, nodeInstance: string, value: unknown) {
    validateTemplateDataOutput(value);
    const output = value as DataOutput;
    const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', runId);
    if (!snapshot?.templateData || snapshot.templateData.id !== output.contextId)
      throw Error('配置与状态结果不属于固定上下文');
    if (
      output.operation === 'configuration' &&
      (output.revision !== snapshot.templateData.configurationRevision ||
        digest(output.value) !== digest(snapshot.templateData.configuration))
    )
      throw Error('配置结果与运行快照不一致');
    if (output.operation === 'state.write') {
      const op = this.store.get<{ runId: string; nodeInstance: string; receipt: DataReceipt }>(
        'template-data-operation',
        output.operationId,
      );
      if (
        !op ||
        op.runId !== runId ||
        op.nodeInstance !== nodeInstance ||
        op.receipt.status !== 'written' ||
        digest(op.receipt.result) !== digest(output)
      )
        throw Error('状态写入结果缺少一致的事务回执');
    }
  }
}
