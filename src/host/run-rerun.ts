import type { Store } from './store';
import { normalizeBindings, policyOf, validateConfiguration } from './configuration';
import { walk } from '../core/validate';
import { digest, errorText, now, uid } from '../shared/utils';
import {
  runRerunPreviewSchema,
  runRerunConfirmSchema,
  type RunRerunPreviewInput,
  type RunRerunConfirmInput,
  type RunRerunPreview,
  type RunRerunSummary,
  type RunRerunDetails,
} from '../shared/run-rerun';
import type { Bindings, BrowserBinding, FlowRecord, PreparedScripts, Run } from '../shared/types';

type Snapshot = FlowRecord &
  Partial<PreparedScripts> & {
    rerunAuthorization?: { browser?: BrowserBinding };
  };
type RequestRecord = { requestId: string; fingerprint: string; runId: string };
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

export function executionVersion(record: FlowRecord, prepared: PreparedScripts) {
  return digest({
    flow: record.flow,
    bindings: record.bindings,
    scriptBundles: prepared.scriptBundles,
  });
}

function configurationAuthority(bindings: Bindings) {
  const config = bindings.configuration;
  return config?.adapter === 'flow-parameters-v1'
    ? { adapter: config.adapter, schema: config.schema }
    : config;
}

// Historical inputs are fixed, but historical bindings are not a permanent grant.
export function assertRerunBindings(original: Bindings, current: Bindings) {
  const before = normalizeBindings(original),
    after = normalizeBindings(current);
  validateConfiguration(before);
  validateConfiguration(after);
  const changed = (name: string): never => {
    throw new Error(`${name}已撤销或改变，请重新核对并选择当前已保存流程`);
  };
  if (before.browserId && before.browserId !== after.browserId) changed('原浏览器绑定');
  for (const [name, path] of Object.entries(before.files))
    if (!Object.hasOwn(after.files, name) || after.files[name] !== path)
      changed('原目录绑定 ' + name + ' ');
  for (const id of before.credentials)
    if (!after.credentials.includes(id)) changed('原凭据授权 ' + id + ' ');
  for (const [name, binding] of Object.entries(before.scriptPackages ?? {}))
    if (
      !Object.hasOwn(after.scriptPackages ?? {}, name) ||
      digest(binding) !== digest(after.scriptPackages![name])
    )
      changed('原脚本包绑定 ' + name + ' ');
  if (
    digest({ policy: policyOf(before), configuration: configurationAuthority(before) }) !==
    digest({ policy: policyOf(after), configuration: configurationAuthority(after) })
  )
    changed('原策略或模板配置定义');
}

function summary(run: Run): RunRerunSummary {
  const { id, flowId, name, state, versionId, createdAt } = run;
  return { id, flowId, name, state, versionId, createdAt };
}

export class RunRerun {
  constructor(
    private store: Store,
    private options: {
      assertAdmitting: () => void;
      busy: (id: string) => boolean;
      preflight: (record: Snapshot) => Promise<PreparedScripts>;
      version: (record: FlowRecord, prepared: PreparedScripts) => string;
      dispatch: () => void;
    },
  ) {}

  private ready(id: string) {
    this.options.assertAdmitting();
    const run = this.store.get<Run>('run', id);
    if (!run) throw new Error('原运行不存在');
    if (!terminal.has(run.state)) throw new Error('原运行尚未结束，不能重新运行');
    if (this.options.busy(id)) throw new Error('原运行仍在收尾，请等待资源回收后重新运行');
    return run;
  }

  details(id: string): RunRerunDetails {
    let reason: string | undefined;
    try {
      this.ready(id);
    } catch (error) {
      reason = errorText(error);
    }
    const run = this.store.get<Run>('run', id);
    const source = run?.rerun && this.store.get<Run>('run', run.rerun.runId);
    return {
      available: reason === undefined,
      ...(reason ? { reason } : {}),
      ...(source ? { source: summary(source) } : {}),
      derived: this.store
        .list<Run>('run')
        .filter((r) => r.rerun?.runId === id)
        .reverse()
        .map(summary),
    };
  }

  private capture(args: RunRerunPreviewInput) {
    const source = this.ready(args.id);
    const snapshot = this.store.get<Snapshot>('snapshot', source.id);
    const current = this.store.get<FlowRecord>('flow', source.flowId);
    if (!current) throw new Error('当前已保存流程不存在，无法核对运行授权');
    if (args.mode === 'snapshot' && !snapshot)
      throw new Error('原执行快照不存在，请核对后选择当前已保存流程');
    const selected = args.mode === 'snapshot' ? snapshot! : current;
    if (selected.id !== source.flowId || selected.flow.id !== source.flowId)
      throw new Error('运行来源与流程标识不一致');
    assertRerunBindings(selected.bindings, current.bindings);
    // Manual snapshots did not historically carry versionId. Supply it explicitly
    // so legacy third-party dependencies cannot be recompiled from today's packages.
    const record: Snapshot = {
      id: selected.id,
      flow: structuredClone(selected.flow),
      bindings: structuredClone(selected.bindings),
      updatedAt: selected.updatedAt,
      ...(args.mode === 'snapshot'
        ? {
            versionId: source.versionId,
            scripts: snapshot!.scripts,
            scriptBundles: snapshot!.scriptBundles,
          }
        : {}),
    };
    const browser = record.bindings.browserId
      ? this.store.get<BrowserBinding>('browser', record.bindings.browserId)
      : undefined;
    return {
      source,
      record,
      browser,
      signature: digest({
        source,
        snapshot,
        current,
        browser,
        mode: args.mode,
        debug: !!args.debug,
      }),
    };
  }

  private async prepare(args: RunRerunPreviewInput) {
    const captured = this.capture(args);
    if (
      args.mode === 'snapshot' &&
      captured.record.scriptBundles === undefined &&
      walk(captured.record.flow.steps).some((n) => n.type === 'script' && n.dependencies.length)
    )
      throw new Error('原快照没有固定脚本依赖，请核对后选择当前已保存流程');
    const prepared = await this.options.preflight(captured.record);
    if (this.capture(args).signature !== captured.signature)
      throw new Error('重新运行预览已过期：流程、授权或来源已改变，请重新预览');
    const preview: RunRerunPreview = {
      token: digest({ signature: captured.signature, scriptBundles: prepared.scriptBundles }),
      mode: args.mode,
      debug: !!args.debug,
      source: summary(captured.source),
      flow: {
        id: captured.record.id,
        name: captured.record.flow.name,
        versionId: executionVersion(captured.record, prepared),
        stepCount: walk(captured.record.flow.steps).length,
        parameterNames: Object.keys(captured.record.flow.parameters).sort(),
        directoryBindings: Object.keys(captured.record.bindings.files).sort(),
        credentialRefs: [...new Set(captured.record.bindings.credentials)].sort(),
        ...(captured.record.bindings.browserId
          ? { browserId: captured.record.bindings.browserId }
          : {}),
        scriptBundles: structuredClone(prepared.scriptBundles),
      },
      warnings: [
        '从首个节点重新执行，可能再次产生文件覆盖、网页提交或其他副作用；请先核对原运行的输出与外部结果。',
        '不会恢复中间步骤或沿用原输出；重新运行不代表原外部操作未生效，也不会清除外发去重或结果未知记录。',
      ],
    };
    return { ...captured, prepared, preview };
  }

  async preview(input: unknown): Promise<RunRerunPreview> {
    return (await this.prepare(runRerunPreviewSchema.parse(input))).preview;
  }

  private previous(args: RunRerunConfirmInput, fingerprint: string) {
    const previous = this.store.get<RequestRecord>('rerun-request', args.requestId);
    if (!previous) return undefined;
    if (previous.fingerprint !== fingerprint)
      throw new Error('重新运行 requestId 已用于不同的确认内容');
    const run = this.store.get<Run>('run', previous.runId);
    if (!run) throw new Error('重新运行确认记录不完整，已阻止重复执行');
    return run;
  }

  // Runtime serializes this method with all manual and scheduled admissions.
  async confirm(input: unknown): Promise<Run> {
    const args = runRerunConfirmSchema.parse(input);
    const fingerprint = digest({ ...args, debug: !!args.debug });
    const previous = this.previous(args, fingerprint);
    if (previous) return previous;
    const captured = await this.prepare(args);
    if (captured.preview.token !== args.token)
      throw new Error('重新运行预览已过期，请重新预览并核对');
    const run = this.store.tx(() => {
      const duplicate = this.previous(args, fingerprint);
      if (duplicate) return duplicate;
      if (this.capture(args).signature !== captured.signature)
        throw new Error('重新运行预览已过期，请重新预览并核对');
      const time = now();
      const versionId = this.options.version(captured.record, captured.prepared);
      const next: Run = {
        id: uid(),
        flowId: captured.source.flowId,
        versionId,
        name: captured.record.flow.name,
        state: 'QUEUED',
        createdAt: time,
        updatedAt: time,
        source: 'manual',
        debug: !!args.debug,
        rerun: { runId: args.id, mode: args.mode, reviewedAt: time },
        business: '已人工核对后从头重新运行；执行结果与外部业务核对分别记录',
      };
      this.store.put('snapshot', next.id, {
        ...captured.record,
        ...captured.prepared,
        versionId,
        rerunAuthorization: { browser: captured.browser },
      });
      this.store.put('run', next.id, next);
      this.store.event(next.id, 'state', '', { state: 'QUEUED' });
      this.store.put('rerun-request', args.requestId, {
        requestId: args.requestId,
        fingerprint,
        runId: next.id,
      } satisfies RequestRecord);
      return next;
    });
    this.options.dispatch();
    return run;
  }

  checkExecution(run: Run, snapshot: Snapshot) {
    if (!run.rerun) return;
    this.ready(run.rerun.runId);
    const current = this.store.get<FlowRecord>('flow', run.flowId);
    if (!current) throw new Error('当前已保存流程不存在，重新运行授权已失效');
    assertRerunBindings(snapshot.bindings, current.bindings);
    const browser = snapshot.bindings.browserId
      ? this.store.get<BrowserBinding>('browser', snapshot.bindings.browserId)
      : undefined;
    if (!snapshot.rerunAuthorization || digest({ browser }) !== digest(snapshot.rerunAuthorization))
      throw new Error('重新运行的浏览器绑定已改变，请重新预览并核对');
  }
}
