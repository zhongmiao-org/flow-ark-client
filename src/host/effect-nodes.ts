import type { Store } from './store';
import type { Templates } from '../templates/service';
import type { FlowRecord } from '../shared/types';
import type { EffectNode, EffectResult } from '../shared/effect-node';
import {
  assertEffectNode,
  assertEffectNodeCapabilities,
  assertEffectPrepareResult,
  assertEffectResolveResult,
} from '../../contracts/effect-node';
import { sha256 } from '../../contracts/package-format';

/** Worker may resolve references, but may not replace any fixed part of the node. */
function configured(input: any, resolved: any): void {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (Object.keys(input).length === 1 && typeof input.$ref === 'string') return;
    if (
      !resolved ||
      typeof resolved !== 'object' ||
      Array.isArray(resolved) ||
      Object.keys(input).sort().join('\0') !== Object.keys(resolved).sort().join('\0')
    )
      throw Error('操作节点输入与固定快照不一致');
    for (const key of Object.keys(input)) configured(input[key], resolved[key]);
  } else if (Array.isArray(input)) {
    if (!Array.isArray(resolved) || input.length !== resolved.length)
      throw Error('操作节点输入与固定快照不一致');
    input.forEach((v, i) => configured(v, resolved[i]));
  } else if (input !== resolved) throw Error('操作节点输入与固定快照不一致');
}

export class EffectNodes {
  private jobs = new Map<string, AbortController>();
  private cancelled = new Set<string>();
  constructor(
    private store: Store,
    private templates: Templates,
  ) {}
  private key(runId: string, instance: string) {
    return JSON.stringify([runId, instance]);
  }
  cancel(runId: string, instance: unknown) {
    if (typeof instance !== 'string' || !instance || instance.length > 2048) return false;
    const key = this.key(runId, instance);
    this.cancelled.add(key);
    this.jobs.get(key)?.abort(Error('该操作步骤已取消，请核对原记录'));
    return true;
  }
  release(runId: string) {
    for (const [key, job] of this.jobs)
      if (JSON.parse(key)[0] === runId) {
        job.abort();
        this.jobs.delete(key);
      }
    for (const key of this.cancelled) if (JSON.parse(key)[0] === runId) this.cancelled.delete(key);
  }
  async preflight(record: FlowRecord, nodes: EffectNode[]) {
    if (!nodes.length) return;
    if (!record.bindings.template)
      throw Error('操作记录步骤需要正式模板实例；制作副本和普通流程不能执行');
    const { pkg, entry } = await this.templates.context(record);
    for (const n of nodes)
      assertEffectNodeCapabilities(n, record.flow.requiredCapabilities, pkg.manifest, entry);
  }
  async perform(
    record: FlowRecord,
    runId: string,
    node: EffectNode,
    instance: string,
    input: unknown,
    signal: AbortSignal,
    active: () => void,
  ): Promise<EffectResult> {
    const key = this.key(runId, instance);
    if (this.jobs.has(key)) throw Error('该操作步骤正在处理，请核对原记录');
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const check = () => {
      active();
      controller.signal.throwIfAborted();
      if (this.store.fault) throw Error(this.store.fault);
      if (this.cancelled.has(key)) throw Error('该操作步骤已取消，请核对原记录');
    };
    this.jobs.set(key, controller);
    try {
      check();
      configured(node, input);
      const resolved = assertEffectNode(input, true) as EffectNode;
      await this.preflight(record, [node]);
      check();
      if (resolved.operation === 'prepare') {
        const ref = record.bindings.template!;
        const live = this.store.get<any>('template-instance', ref.instanceId);
        const grant = live?.grants?.[resolved.action];
        const authorize = () => {
          check();
          const current = this.store.get<any>('template-instance', ref.instanceId);
          if (
            !current ||
            current.packageKey !== ref.packageKey ||
            current.entryFlows[ref.entryId] !== record.id ||
            (grant !== 'auto' && grant !== 'confirm') ||
            current.grants?.[resolved.action] !== grant
          )
            throw Error('当前动作未授权或确认期间授权已变化，请返回原入口重新核对');
        };
        authorize();
        const currentRecord = {
          ...record,
          bindings: { ...record.bindings, grants: { ...live.grants } },
        };
        const raw = await this.templates.effectPrepare(
          currentRecord,
          runId,
          {
            action: resolved.action,
            key: resolved.key,
            ...(resolved.description === undefined ? {} : { description: resolved.description }),
            ...(resolved.review ? { review: resolved.review } : {}),
          },
          controller.signal,
          authorize,
        );
        check();
        const result = {
          version: 1,
          operation: 'prepare',
          id: raw.id,
          action: raw.action,
          key: raw.key,
          runId: raw.runId,
          execute: raw.execute,
          state: raw.state,
        };
        assertEffectPrepareResult(result, { action: resolved.action, key: resolved.key as string });
        if (raw.execute && raw.runId !== runId) throw Error('准备回执不属于本次运行');
        return result as EffectResult;
      }
      const receipt = assertEffectPrepareResult(resolved.receipt),
        ref = record.bindings.template!;
      const verify = () => {
        check();
        const old = this.store.get<any>('template-effect', receipt.id);
        if (
          !old ||
          !receipt.execute ||
          receipt.state !== 'submitting' ||
          receipt.runId !== runId ||
          old.instanceId !== ref.instanceId ||
          old.runId !== runId ||
          old.state !== 'submitting' ||
          old.action !== receipt.action ||
          old.key !== receipt.key ||
          receipt.id !== sha256(ref.instanceId + ':' + receipt.action + ':' + receipt.key)
        )
          throw Error('准备回执与本实例、本次运行的提交中记录不一致');
      };
      verify();
      await this.templates.effectResolve(
        record,
        runId,
        {
          id: receipt.id,
          state: resolved.state,
          ...(resolved.evidence === undefined ? {} : { evidence: resolved.evidence }),
        },
        controller.signal,
        verify,
      );
      check();
      const result = { version: 1, operation: 'resolve', id: receipt.id, state: resolved.state };
      assertEffectResolveResult(resolved, result);
      return result as EffectResult;
    } finally {
      signal.removeEventListener('abort', abort);
      this.jobs.delete(key);
    }
  }
}
