import type { Store } from './store';
import type { FlowRecord, Run } from '../shared/types';
import type { TaskDetail } from '../shared/planning';
import {
  desktopRunMethods,
  desktopBinding,
  desktopBindingCheck,
  desktopWriteResult,
  type DesktopReceipt,
} from '../shared/desktop-run';
import { desktopSelectionPreview } from '../shared/desktop-windows';
import { digest, now, uid } from '../shared/utils';
import { planningFlowHash } from './planning-scope';

export function desktopStep(record: FlowRecord) {
  const node = record.flow.steps[0],
    target = record.desktopTarget;
  if (
    record.flow.steps.length !== 1 ||
    node?.type !== 'desktop' ||
    node.target !== 'selected-text' ||
    !target ||
    target.replacementHash !== digest(node.text) ||
    !node.text.trim() ||
    record.webTarget ||
    record.outputTarget ||
    record.toolTargets?.length ||
    record.bindings.template
  )
    throw new Error('仅支持从原选区采纳的单步应用方案；流程或文字已改变，请重新核对');
  return { node, target };
}
type BindJob = { cancelled: boolean; bindingId: string };
export class DesktopRuns {
  private jobs = new Map<string, BindJob>();
  private requests = new Map<string, number>();
  constructor(
    private store: Store,
    private deps: {
      system: (method: string, args: unknown) => Promise<any>;
      detail: (id: string) => TaskDetail;
      available: () => void;
      idle: () => void;
    },
  ) {}
  cancelAll() {
    for (const job of this.jobs.values()) job.cancelled = true;
  }
  private remember(requestId: string) {
    for (const [id, expires] of this.requests)
      if (expires <= Date.now()) {
        this.requests.delete(id);
        this.jobs.delete(id);
      }
    if (this.requests.has(requestId) || this.requests.size >= 256)
      throw new Error('绑定请求已使用，请重新读取目标');
    this.requests.set(requestId, Date.now() + 300000);
  }
  async request(method: string, raw: unknown) {
    if (method === 'desktop.run.cancel') {
      const { requestId } = desktopRunMethods[method].parse(raw);
      const job = this.jobs.get(requestId);
      if (job) {
        job.cancelled = true;
        await this.deps
          .system('desktop.binding.release', { bindingId: job.bindingId })
          .catch(() => {});
      }
      if (!this.requests.has(requestId)) this.remember(requestId);
      return true;
    }
    if (method === 'desktop.run.release') {
      const args = desktopRunMethods[method].parse(raw);
      return this.deps.system('desktop.binding.release', args);
    }
    const args = desktopRunMethods['desktop.run.bind'].parse(raw);
    this.remember(args.requestId);
    const job = { cancelled: false, bindingId: uid() };
    this.jobs.set(args.requestId, job);
    const current = () => {
      this.deps.available();
      this.deps.idle();
      const detail = this.deps.detail(args.taskId),
        record = detail.flow;
      if (
        job.cancelled ||
        !record ||
        record.id !== args.flowId ||
        detail.task.revision !== args.revision ||
        detail.task.status === 'generating' ||
        detail.proposal ||
        planningFlowHash(record) !== args.flowHash
      )
        throw new Error('任务或窗口绑定请求已变化，请重新核对');
      const { target, node } = desktopStep(record);
      if (target.taskId !== args.taskId) throw new Error('应用方案不属于当前任务');
      return { record, target, node, detail };
    };
    try {
      const before = current();
      const reference = {
        observationId: args.observationId,
        windowId: args.windowId,
        previewId: args.previewId,
      };
      const source = desktopSelectionPreview.parse(
        await this.deps.system('desktop.selection.resolve', reference),
      );
      current();
      if (
        source.status !== 'ready' ||
        source.redacted ||
        digest(source.text) !== before.target.sourceHash
      )
        throw new Error('选中文字与采纳时的原文不一致，未绑定窗口');
      const binding = desktopBinding.parse(
        await this.deps.system('desktop.binding.hold', {
          ...reference,
          bindingId: job.bindingId,
          replacementHash: before.target.replacementHash,
        }),
      );
      const fresh = current();
      if (
        binding.bindingId !== job.bindingId ||
        binding.sourceHash !== fresh.target.sourceHash ||
        binding.replacementHash !== fresh.target.replacementHash ||
        binding.expiresAt <= Date.now()
      )
        throw new Error('窗口绑定来源不一致');
      this.store.put('flow', fresh.record.id, {
        ...fresh.record,
        desktopTarget: { ...fresh.target, binding },
      });
      return this.deps.detail(args.taskId);
    } catch (error) {
      // Main might have retained the lease even if the reply was lost.
      await this.deps
        .system('desktop.binding.release', { bindingId: job.bindingId })
        .catch(() => {});
      throw error;
    }
    // Retain a bounded cancellation handle for a reply that arrived after the page left.
  }
  async verify(record: FlowRecord, runId?: string) {
    const { target } = desktopStep(record),
      binding = target.binding;
    if (!binding) throw new Error('请重新选择窗口并核对原选区，再开始试运行');
    const checked = desktopBindingCheck.parse(
      await this.deps.system('desktop.binding.verify', {
        bindingId: binding.bindingId,
        ...(runId ? { runId } : {}),
      }),
    );
    const { original, ...identity } = checked;
    if (
      digest(identity) !== digest(binding) ||
      digest(original) !== target.sourceHash ||
      binding.expiresAt <= Date.now()
    )
      throw new Error('窗口绑定或原选区已变化，请重新选择');
    return checked;
  }
  async claim(record: FlowRecord, runId: string) {
    const { target } = desktopStep(record);
    await this.verify(record);
    await this.deps.system('desktop.binding.claim', {
      bindingId: target.binding!.bindingId,
      runId,
    });
  }
  async release(record: FlowRecord, runId: string) {
    const binding = record.desktopTarget?.binding;
    if (!binding) return { confirmed: true };
    try {
      const result = await this.deps.system('desktop.binding.release', {
        bindingId: binding.bindingId,
        runId,
      });
      return {
        confirmed: result?.confirmed === true,
        ...(result?.confirmed === true ? {} : { error: '应用助手退出尚未确认，请核对文档结果' }),
      };
    } catch {
      return { confirmed: false, error: '应用助手退出未能确认，请核对文档结果' };
    }
  }
  async perform(run: Run, record: FlowRecord, nodeId: string, instance: string, check: () => void) {
    const { node, target } = desktopStep(record);
    if (
      node.id !== nodeId ||
      instance !== node.id ||
      !run.review?.desktopReviewed ||
      run.task?.id !== target.taskId ||
      !target.binding
    )
      throw new Error('本次运行没有应用选区的单次授权');
    const key = run.id + ':' + node.id;
    if (this.store.get('desktop-effect', key))
      throw new Error('这次修改已经尝试，不能再次发送，请核对现有回执');
    await this.verify(record, run.id);
    check();
    const receipt: DesktopReceipt = {
      runId: run.id,
      nodeId: node.id,
      bindingId: target.binding.bindingId,
      attemptedAt: now(),
      status: 'unknown',
      message: '修改尝试已记录，结果尚未确认；不会自动重试。',
    };
    this.store.tx(() => {
      if (this.store.get('desktop-effect', key)) throw new Error('重复修改尝试');
      this.store.put('desktop-effect', key, receipt);
      this.store.event(run.id, 'desktop-write-attempt', instance, { bindingId: receipt.bindingId });
    });
    let result: DesktopReceipt;
    let dispatched = false;
    try {
      check();
      dispatched = true;
      const reply = desktopWriteResult.parse(
        await this.deps.system('desktop.binding.write', {
          bindingId: receipt.bindingId,
          runId: run.id,
          text: node.text,
        }),
      );
      if (
        reply.status === 'verified' &&
        (reply.readback !== node.text ||
          !reply.original ||
          digest(reply.original) !== target.sourceHash)
      )
        throw new Error('回执内容不一致');
      result = { ...receipt, ...reply, completedAt: now() };
    } catch {
      result = {
        ...receipt,
        completedAt: now(),
        status: dispatched ? 'unknown' : 'not-written',
        message: dispatched
          ? '可能已修改文档，结果尚未确认。请人工核对，未自动重试。'
          : '运行已停止，未发出本次文字修改。',
      };
    }
    this.store.tx(() => {
      this.store.put('desktop-effect', key, result);
      this.store.event(run.id, 'desktop-write-result', instance, {
        status: result.status,
        message: result.message,
      });
      if (result.status === 'unknown')
        this.store.attention(
          'unknown-result',
          '应用修改结果待核对',
          { runId: run.id, nodeId: node.id },
          'desktop:' + key,
        );
    });
    if (result.status !== 'verified') throw new Error(result.message);
    return { verified: true, message: result.message };
  }
  receipts(runId: string): DesktopReceipt[] {
    return this.store.list<DesktopReceipt>('desktop-effect').filter((item) => item.runId === runId);
  }
}
