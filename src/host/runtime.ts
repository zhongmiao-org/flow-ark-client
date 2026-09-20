import { join, dirname } from 'node:path';
import { access, stat, writeFile, realpath } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { RecruitingCoordinator } from '../recruiting/coordinator';
import { BossRecruitingAdapter, ZhaopinRecruitingAdapter } from '../recruiting/sites';
import type { PreparedAction } from '../recruiting/actions';
import { Store } from './store';
import { scheduleCreateSchema, scheduleUpdateSchema } from '../shared/schedules';
import { flowExportSchema, templateContentLimit } from '../shared/flow-export';
import { listRuns, runOverview } from './run-history';
import { ArtifactCleanup } from './artifact-cleanup';
import { RunRerun, executionVersion } from './run-rerun';
import { Sessions } from './sessions';
import { ScriptProcesses } from './script-processes';
import { ScriptProcessInterruptedError, type ScriptOwner } from '../shared/script-supervision';
import type { CleanupResult } from '../shared/embedded-lifecycle';
import { child, killOwnedTree } from './processes';
import { Rpc } from '../shared/rpc';
import { uid, now, digest, errorText, redact } from '../shared/utils';
import { validateFlow, validateObject, walk } from '../core/validate';
import { assertBrowserOperations } from '../adapters/browser-scope';
import { discoverBrowsers, inspectBrowser, validateBinding } from '../adapters/browsers';
import { compileScript, inspectScriptPackage, verifyScriptBundle } from '../adapters/script-bundle';
import { ArtifactFiles } from '../adapters/artifacts';
import { artifactPath, scopedTarget, uploadPath } from '../adapters/files';
import { staticUploadFields, uploadSource, uploadText } from '../shared/upload-source';
import { templates, instantiate, packageFlow, validateTemplate } from '../recruiting/templates';
import {
  configureTemplate,
  normalizeBindings,
  policyOf,
  validateConfiguration,
} from './configuration';
import { draftReply, validateDraft } from '../recruiting/ai';
import example from '../../contracts/example.flow.json';
import type {
  Flow,
  FlowRecord,
  Bindings,
  Run,
  RunState,
  Schedule,
  BrowserBinding,
  Bootstrap,
  PreparedScripts,
  Template,
  ExecutionObservation,
} from '../shared/types';
const terminal = new Set(['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
type Active = {
  id: string;
  child: ChildProcess;
  rpc: Rpc;
  cancelling: boolean;
  interruption?: string;
  sessionCleanup?: Promise<CleanupResult>;
  workerCleanup?: Promise<CleanupResult>;
  scriptCleanup?: Promise<CleanupResult>;
  workerClosing?: boolean;
  cancelTimer?: NodeJS.Timeout;
  controlPending?: boolean;
  done: Promise<void>;
  abort: AbortController;
};
export class Runtime {
  readonly store: Store;
  readonly sessions: Sessions;
  readonly scripts: ScriptProcesses;
  readonly ready: Promise<void>;
  readonly recruiting: RecruitingCoordinator;
  private active?: Active;
  private artifactFiles: ArtifactFiles;
  private artifactCleanup: ArtifactCleanup;
  private reruns: RunRerun;
  private pendingCapabilities = new Map<string, number>();
  private stopping = false;
  private suspended = false;
  private runtimeBlock?: string;
  private recovering = true;
  private ticking = false;
  private lastTick = Date.now();
  private timer?: NodeJS.Timeout;
  private secrets: string[] = [];
  private admissions: Promise<void> = Promise.resolve();
  constructor(
    readonly dataPath: string,
    private dir: string,
    private executable: string,
    key: Buffer,
    private system: (method: string, args: any) => Promise<any>,
  ) {
    this.artifactFiles = new ArtifactFiles(dataPath);
    this.store = new Store(join(dataPath, 'flowark.sqlite'), key);
    this.store.recover();
    this.scripts = new ScriptProcesses({
      store: this.store,
      dir,
      executable,
      assertOwner: (owner) => this.assertScriptOwner(owner),
      call: (owner, method, args) => this.scriptRequest(owner, method, args),
    });
    this.artifactCleanup = new ArtifactCleanup(
      dataPath,
      this.store,
      (id) =>
        this.stopping ||
        this.active?.id === id ||
        this.scripts.hasRun(id) ||
        (this.pendingCapabilities.get(id) ?? 0) > 0,
    );
    this.reruns = new RunRerun(this.store, {
      assertAdmitting: () => this.assertAdmitting(),
      busy: (id) =>
        this.active?.id === id ||
        this.scripts.hasRun(id) ||
        (this.pendingCapabilities.get(id) ?? 0) > 0,
      preflight: (record) => this.preflight(record),
      version: (record, prepared) => this.version(record, prepared),
      dispatch: () => this.dispatch(),
    });
    this.recruiting = new RecruitingCoordinator(this.store, () =>
      this.system('notification', { title: 'FlowArk 有新的联系方式待办' }),
    );
    this.sessions = new Sessions(dir, executable, dataPath, system);
    if (!this.store.list('flow').length)
      this.saveFlow(validateFlow(example), { files: {}, credentials: [] });
    this.ready = this.scripts.ready.then(() => {
      // A recovery probe can take several seconds. Plans missed during that
      // interval are skipped before any timer or queued admission can proceed.
      this.skipMissed('application-restart');
      this.lastTick = Date.now();
      this.recovering = false;
      if (!this.stopping)
        this.timer = setInterval(
          () => void this.tick().catch((e) => (this.store.fault = errorText(e))),
          1000,
        );
    });
    // Keep direct Runtime users from producing an unhandled rejection while
    // preserving the rejected ready promise for init and execution admission.
    void this.ready.catch((error) => {
      this.recovering = false;
      this.store.fault ??= '脚本资源恢复核对失败：' + errorText(error);
    });
  }
  saveFlow(flow: Flow, bindings: Bindings): FlowRecord {
    bindings = normalizeBindings(bindings);
    validateConfiguration(bindings);
    if (bindings.configuration?.adapter === 'flow-parameters-v1')
      flow = { ...flow, parameters: bindings.configuration.values as any };
    validateFlow(flow);
    const policy = policyOf(bindings);
    if (policy) validateObject('RecruitingPolicy', policy);
    const record = {
      id: flow.id,
      flow: structuredClone(flow),
      bindings: structuredClone(bindings),
      updatedAt: now(),
    };
    this.store.put('flow', flow.id, record);
    return record;
  }
  private version(record: FlowRecord, prepared: PreparedScripts) {
    const id = executionVersion(record, prepared);
    if (!this.store.get('version', id))
      this.store.put('version', id, { ...record, ...prepared, versionId: id });
    return id;
  }
  private observeExecution(): ExecutionObservation {
    const active = this.active;
    return {
      observedAt: now(),
      active: active
        ? {
            runId: active.id,
            phase:
              active.cancelling ||
              active.workerClosing ||
              active.interruption ||
              active.abort.signal.aborted
                ? 'closing'
                : 'executing',
          }
        : null,
    };
  }
  async bootstrap(): Promise<Bootstrap> {
    await this.ready.catch(() => {});
    // Finish external reads before sampling synchronous history and its current
    // owner. A slow credential service must not attach a newer owner to old runs.
    const credentials = await this.system('credentials.list', {});
    const runs = this.store.list<Run>('run').reverse();
    return {
      flows: this.store
        .list<FlowRecord>('flow')
        .map((r) => ({ ...r, bindings: normalizeBindings(r.bindings) })),
      runs: runs.slice(0, 200),
      runOverview: runOverview(runs),
      browsers: this.store.list('browser'),
      schedules: this.store.list('schedule'),
      attention: this.store
        .list<any>('attention')
        .reverse()
        .map((item) => {
          const a =
            item.detail?.actionId && this.store.get<PreparedAction>('action', item.detail.actionId);
          return a
            ? {
                ...item,
                detail: {
                  ...item.detail,
                  actionState: a.state,
                  policyHash: a.policyHash,
                  proposal: a,
                  reason: a.reason,
                },
              }
            : item;
        }),
      templates,
      credentials,
      fault: this.store.fault,
      runtimeBlock: this.executionBlock(),
      dataPath: this.dataPath,
      execution: this.observeExecution(),
    };
  }
  async preflight(record: FlowRecord & Partial<PreparedScripts>): Promise<PreparedScripts> {
    const flow = validateFlow(record.flow);
    const steps = walk(flow.steps);
    if (steps.some((n) => n.type === 'browser' || n.type === 'recruiting')) {
      const b = this.store.get<BrowserBinding>('browser', record.bindings.browserId ?? '');
      if (!b) throw new Error('请先选择本机浏览器');
      const current =
        b.product === 'embedded'
          ? await this.system('browser.embedded.binding', {})
          : await validateBinding(b);
      assertBrowserOperations(
        current,
        steps.filter((n) => n.type === 'browser'),
      );
    }
    for (const n of steps) {
      if (n.type === 'file' || n.type === 'excel')
        await this.fileDirectory(record.bindings, n.binding);
      if (n.type === 'browser' && n.operation === 'upload') {
        try {
          const source = staticUploadFields(n.value, flow.parameters);
          const name = source?.name.known ? uploadText(source.name.value, 'name') : undefined;
          if (source?.binding.known) {
            const binding = uploadText(source.binding.value, 'binding');
            const root = await this.fileDirectory(record.bindings, binding);
            if (name !== undefined) scopedTarget(root, name);
          }
        } catch (e) {
          throw new Error(`上传步骤 ${n.id}：${errorText(e)}`);
        }
      }
    }
    for (const id of record.bindings.credentials)
      if (!(await this.system('credentials.list', {})).includes(id))
        throw new Error('未配置凭据：' + id);
    const scriptNodes = steps.filter((n) => n.type === 'script');
    if (scriptNodes.length && !['darwin', 'linux'].includes(process.platform))
      throw new Error('当前系统尚不支持脚本进程监护；请在 macOS 或 Linux 执行脚本流程');
    if (record.scriptBundles !== undefined) {
      if (
        !record.scripts ||
        record.scriptBundles.length !== scriptNodes.length ||
        new Set(record.scriptBundles.map((b) => b.nodeId)).size !== scriptNodes.length
      )
        throw new Error('脚本快照清单不完整');
      for (const n of scriptNodes) {
        const bundle = record.scriptBundles.find((b) => b.nodeId === n.id);
        if (!bundle) throw new Error('脚本快照缺少节点：' + n.id);
        validateObject('ScriptBundle', bundle);
        await verifyScriptBundle(record.scripts[n.id], bundle.sha256);
      }
      return { scripts: record.scripts, scriptBundles: record.scriptBundles };
    }
    if (record.versionId && scriptNodes.some((n) => n.dependencies.length))
      throw new Error('旧计划没有固定脚本依赖，请重新保存计划');
    const prepared: PreparedScripts = { scripts: {}, scriptBundles: [] };
    for (const n of steps)
      if (n.type === 'script') {
        const bundle = await compileScript({
          code: n.code,
          language: n.language,
          dependencies: n.dependencies,
          bindings: record.bindings.scriptPackages,
          directory: join(this.dataPath, 'compiled'),
        });
        prepared.scripts[n.id] = bundle.path;
        prepared.scriptBundles.push({
          nodeId: n.id,
          sha256: bundle.sha256,
          dependencies: bundle.dependencies,
        });
      }
    return prepared;
  }
  private assertAdmitting() {
    const blocked = this.executionBlock();
    if (blocked) throw new Error(blocked);
    if (this.suspended) throw new Error('系统正在休眠，恢复后请重新开始运行');
    if (this.stopping || this.store.fault) throw new Error(this.store.fault ?? '应用正在退出');
  }
  private blockExecution(reason: string) {
    this.runtimeBlock ??= redact(
      `资源回收未确认，执行已停止。请核对运行结果。${reason}`,
      this.secrets,
    );
    return this.runtimeBlock;
  }
  private executionBlock() {
    if (this.recovering) return '正在核对上次运行的脚本资源，请稍候';
    if (this.scripts.recoveryError) this.blockExecution(this.scripts.recoveryError);
    if (this.sessions.recoveryError) this.blockExecution(this.sessions.recoveryError);
    return this.runtimeBlock;
  }
  private recordExecutionBlock(runId?: string) {
    if (this.recovering) return;
    const reason = this.executionBlock();
    if (reason)
      this.store.attention(
        'limitation',
        '资源回收未确认，请核对运行结果与恢复说明',
        { runId, reason },
        'runtime-resource-block',
      );
  }
  private checkActive(active: Active) {
    const blocked = this.executionBlock();
    if (
      blocked ||
      this.active !== active ||
      active.cancelling ||
      active.interruption ||
      active.abort.signal.aborted
    )
      throw new Error(blocked ?? active.interruption ?? '运行已停止');
  }
  private assertScriptOwner(owner: ScriptOwner) {
    this.assertAdmitting();
    const active = this.active;
    if (!active || active.id !== owner.runId) throw new Error('脚本所属运行已停止');
    this.checkActive(active);
    if (active.interruption) throw new Error(active.interruption);
    if (active.workerClosing || !active.child.connected) throw new Error('执行进程已断开');
  }
  private async scriptRequest(owner: ScriptOwner, method: string, args: any) {
    this.assertScriptOwner(owner);
    let result: unknown;
    if (method === 'log' || method === 'progress')
      result = await this.workerRequest(owner.runId, 'event', {
        type: method,
        nodeInstance: owner.nodeInstance,
        data: args,
      });
    else if (method === 'artifact')
      result = await this.workerRequest(owner.runId, 'artifact.create', args);
    else if (method === 'credential')
      result = await this.workerRequest(owner.runId, 'credential', args);
    else throw new Error('脚本能力不在白名单');
    this.assertScriptOwner(owner);
    return result;
  }
  private async waitActive<T>(active: Active, pending: Promise<T>): Promise<T> {
    const signal = active.abort.signal;
    let interrupt!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      interrupt = () => reject(signal.reason ?? new Error('运行已停止'));
      if (signal.aborted) interrupt();
      else signal.addEventListener('abort', interrupt, { once: true });
    });
    try {
      return await Promise.race([pending, stopped]);
    } finally {
      signal.removeEventListener('abort', interrupt);
    }
  }
  private releaseSession(active: Active, destroy: boolean): Promise<CleanupResult> {
    if (active.sessionCleanup) return active.sessionCleanup;
    const pending = (async () => {
      let result: CleanupResult;
      try {
        result = await this.sessions.release(active.id, destroy);
      } catch (error) {
        result = { confirmed: false, error: '浏览器资源回收失败：' + errorText(error) };
      }
      if (!result?.confirmed) {
        result = { ...result, confirmed: false, error: result?.error ?? '未取得浏览器回收确认' };
        this.blockExecution(result.error!);
      }
      return result;
    })();
    if (destroy) active.sessionCleanup = pending;
    return pending;
  }
  private stopScripts(active: Active, reason?: string): Promise<CleanupResult> {
    if (active.scriptCleanup) return active.scriptCleanup;
    active.scriptCleanup = (async () => {
      let result: CleanupResult;
      try {
        // stopRun revokes this Run synchronously, including invocations whose
        // execute handlers have not yet resumed from their first await.
        result = await this.scripts.stopRun(active.id, reason);
      } catch (error) {
        result = { confirmed: false, error: '脚本资源回收失败：' + errorText(error) };
      }
      if (!result.confirmed) this.blockExecution(result.error ?? '未取得脚本回收确认');
      return result;
    })();
    return active.scriptCleanup;
  }
  private stopWorker(active: Active): Promise<CleanupResult> {
    if (active.workerCleanup) return active.workerCleanup;
    active.workerClosing = true;
    active.workerCleanup = (async () => {
      const scripts = this.stopScripts(active, active.interruption ?? '运行已停止');
      let error: string | undefined;
      try {
        await killOwnedTree(active.child);
      } catch (cause) {
        error = errorText(cause);
      }
      const confirmed =
        !active.child.pid || active.child.exitCode !== null || active.child.signalCode !== null;
      if (!confirmed) {
        error = '执行进程回收未确认' + (error ? '：' + error : '');
        this.blockExecution(error);
      }
      const scriptCleanup = await scripts;
      const errors = [error, scriptCleanup.error].filter(Boolean);
      return {
        confirmed: confirmed && scriptCleanup.confirmed,
        ...(errors.length ? { error: errors.join('\n') } : {}),
        ...(scriptCleanup.warnings?.length ? { warnings: scriptCleanup.warnings } : {}),
      };
    })();
    return active.workerCleanup;
  }
  private stop(active: Active, interruption?: string) {
    if (interruption) active.interruption ??= redact(interruption, this.secrets);
    if (active.cancelling) return;
    active.cancelling = true;
    active.abort.abort(new Error(active.interruption ?? '用户取消'));
    void this.stopScripts(active, active.interruption ?? '用户取消');
    // This timer starts before any browser close await. A stuck page cannot keep
    // an unresponsive Worker alive indefinitely. Script cleanup runs independently.
    active.cancelTimer = setTimeout(() => {
      void this.stopWorker(active).then(() => active.rpc.close());
    }, 2000);
    active.cancelTimer.unref();
    if (active.child.connected)
      try {
        active.child.send({ control: 'cancel' }, (error) => {
          if (error) active.rpc.close();
        });
      } catch {
        active.rpc.close();
      }
    void this.releaseSession(active, true);
    // Storage failure must remain visible, but must not prevent the stop above.
    this.store.state(active.id, 'CANCELLING');
  }
  private async fileDirectory(bindings: Bindings, binding: string) {
    if (!Object.hasOwn(bindings.files, binding) || !bindings.files[binding])
      throw new Error('未绑定文件目录：' + binding);
    try {
      const root = await realpath(bindings.files[binding]);
      if (!(await stat(root)).isDirectory()) throw new Error('not a directory');
      return root;
    } catch {
      throw new Error('文件目录不可用，请重新选择：' + binding);
    }
  }
  async enqueue(
    flowId: string,
    versionId?: string,
    scheduleId?: string,
    triggerId?: string,
    scheduleRevision?: string,
    debug = false,
  ) {
    if (!this.recovering) this.assertAdmitting();
    else if (this.stopping || this.store.fault) throw new Error(this.store.fault ?? '应用正在退出');
    // Capture the requested content before waiting, while serializing admission
    // so a cheap second preflight cannot overtake the first manual request.
    const record = this.store.get<FlowRecord>(versionId ? 'version' : 'flow', versionId ?? flowId);
    if (!record) throw new Error('流程或版本不存在');
    const pending = this.admissions.then(async () => {
      await this.ready;
      return this.admit(record, flowId, versionId, scheduleId, triggerId, scheduleRevision, debug);
    });
    this.admissions = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  private async admit(
    record: FlowRecord,
    flowId: string,
    versionId?: string,
    scheduleId?: string,
    triggerId?: string,
    scheduleRevision?: string,
    debug = false,
  ) {
    const check = () => {
      this.assertAdmitting();
      if (scheduleId) {
        const schedule = this.store.get<Schedule>('schedule', scheduleId);
        if (
          !schedule?.enabled ||
          schedule.versionId !== versionId ||
          schedule.revision !== scheduleRevision
        )
          throw new Error('计划已暂停或配置已变化，本次触发已跳过');
      }
    };
    check();
    const prepared = await this.preflight(record);
    check();
    const id = uid();
    const version = versionId ?? this.version(record, prepared);
    const run: Run = {
      id,
      flowId,
      versionId: version,
      name: record.flow.name,
      state: 'QUEUED',
      createdAt: now(),
      updatedAt: now(),
      source: scheduleId ? 'schedule' : 'manual',
      debug: !scheduleId && debug,
      scheduleId,
      business: '执行结果与外部业务核对分别记录',
    };
    this.store.tx(() => {
      if (triggerId && this.store.get('trigger', triggerId)) throw new Error('重复计划触发');
      this.store.put('snapshot', id, { ...structuredClone(record), ...prepared });
      this.store.put('run', id, run);
      this.store.event(id, 'state', '', { state: 'QUEUED' });
      if (triggerId) this.store.put('trigger', triggerId, { id, at: now() });
    });
    this.dispatch();
    return run;
  }
  private dispatch() {
    void this.pump().catch(() => {
      this.store.fault ??= '运行状态无法可靠保存，已停止接收新任务；请保留数据并重启后核对';
    });
  }
  private async pump() {
    await this.ready;
    if (this.active || this.stopping || this.suspended || this.store.fault || this.executionBlock())
      return;
    const run = this.store.list<Run>('run').find((r) => r.state === 'QUEUED');
    if (!run) return;
    const proc = child(join(this.dir, 'worker.cjs'), this.executable);
    const rpc = new Rpc(
      (m) => proc.send(m),
      (method, args) => this.workerRequest(run.id, method, args),
    );
    let settled!: () => void;
    const done = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const active: Active = {
      id: run.id,
      child: proc,
      rpc,
      cancelling: false,
      done,
      abort: new AbortController(),
    };
    this.active = active;
    proc.on('message', (m) => void rpc.receive(m as any));
    const lost = () => {
      if (!active.workerClosing && !active.cancelling) {
        active.interruption ??= '执行进程意外退出';
        active.abort.abort(new Error(active.interruption));
        void this.stopScripts(active, active.interruption);
        void this.releaseSession(active, true);
      }
      rpc.close();
    };
    proc.on('exit', lost);
    proc.on('disconnect', lost);
    proc.on('error', lost);
    try {
      let failure: string | undefined;
      let outputs: unknown;
      try {
        this.store.state(run.id, 'RUNNING');
        const s = this.store.get<FlowRecord & PreparedScripts>('snapshot', run.id)!;
        this.reruns.checkExecution(run, s);
        const prepared = await this.waitActive(active, this.preflight(s)); // Never recompile a fixed bundle.
        this.checkActive(active);
        this.reruns.checkExecution(run, s);
        outputs = await rpc.call(
          'execute',
          {
            ...s,
            parameters: s.flow.parameters,
            debug: Boolean(run.debug),
            ...prepared,
            executable: this.executable,
          },
          24 * 3600000,
        );
      } catch (error) {
        failure = errorText(error);
      }
      const results: CleanupResult[] = [];
      if (failure || active.cancelling || active.interruption || this.executionBlock()) {
        active.abort.abort(new Error('运行已停止'));
        results.push(
          ...(await Promise.all([this.releaseSession(active, true), this.stopWorker(active)])),
        );
      } else {
        results.push(await this.stopWorker(active));
        results.push(await this.releaseSession(active, false));
      }
      // Cancel/lost may arrive while normal release or process cleanup is pending.
      // Sessions retains this Run's association until finishRun below.
      if (active.cancelling || active.interruption || this.executionBlock()) {
        active.abort.abort(new Error('运行已停止'));
        results.push(await this.releaseSession(active, true));
      }
      const blocked = this.executionBlock();
      const state: RunState =
        blocked || active.interruption || results.some((r) => !r.confirmed)
          ? 'INTERRUPTED'
          : active.cancelling
            ? 'CANCELLED'
            : failure
              ? 'FAILED'
              : 'SUCCEEDED';
      const errors = [
        ...new Set(
          [failure, active.interruption, ...results.map((r) => r.error), blocked].filter(Boolean),
        ),
      ];
      const old = this.store.get<Run>('run', run.id);
      if (old && !terminal.has(old.state)) {
        if (state === 'SUCCEEDED') this.store.put('output', run.id, redact(outputs, this.secrets));
        this.store.state(
          run.id,
          state,
          state === 'SUCCEEDED'
            ? {}
            : {
                error: redact(errors.join('\n') || '用户取消', this.secrets),
                business: '若含外部提交，请核对结果；不会自动重试',
              },
        );
        const warnings = results.flatMap((r) => r.warnings ?? []);
        if (warnings.length)
          this.store.event(run.id, 'log', '', {
            message: redact([...new Set(warnings)].join('\n'), this.secrets),
          });
      }
      this.recordExecutionBlock(run.id);
    } finally {
      clearTimeout(active.cancelTimer);
      this.sessions.finishRun(run.id);
      rpc.close();
      this.secrets = [];
      if (this.active === active) this.active = undefined;
      this.scripts.finishRun(run.id);
      settled();
      if (!this.stopping && !this.store.fault && !this.executionBlock()) this.dispatch();
    }
  }
  private async workerRequest(id: string, method: string, args: any): Promise<any> {
    this.pendingCapabilities.set(id, (this.pendingCapabilities.get(id) ?? 0) + 1);
    try {
      return await this.performWorkerRequest(id, method, args);
    } finally {
      const remaining = this.pendingCapabilities.get(id)! - 1;
      if (remaining) this.pendingCapabilities.set(id, remaining);
      else this.pendingCapabilities.delete(id);
    }
  }
  private async performWorkerRequest(id: string, method: string, args: any): Promise<any> {
    // A cancellation can overtake execute or arrive after the Run was revoked.
    // Its exact invocation tombstone must be recorded before normal owner checks.
    if (method === 'script.cancel') return this.scripts.cancel(id, args.invocationId);
    if (this.active?.id !== id) throw new Error('运行已停止');
    this.checkActive(this.active);
    const runSignal = this.active.abort.signal;
    const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', id)!;
    if (method === 'script.execute') {
      const active = this.active;
      const node = walk(snapshot.flow.steps).find((step) => step.id === args.nodeId);
      const bundle = snapshot.scriptBundles?.find((item) => item.nodeId === args.nodeId);
      const compiled = snapshot.scripts?.[args.nodeId];
      if (!node || node.type !== 'script' || !bundle || !compiled)
        throw new Error('脚本节点或固定编译快照不存在');
      try {
        return await this.scripts.execute({
          runId: id,
          invocationId: args.invocationId,
          nodeId: node.id,
          nodeInstance: args.nodeInstance,
          compiled,
          sha256: bundle.sha256,
          input: args.input,
        });
      } catch (error) {
        if (error instanceof ScriptProcessInterruptedError) {
          active.interruption ??= redact(errorText(error), this.secrets);
          active.abort.abort(error);
          void this.stopScripts(active, active.interruption);
          void this.releaseSession(active, true);
        }
        throw error;
      }
    }
    if (method === 'event') {
      if (!['node-start', 'node-end', 'log', 'progress', 'error'].includes(args.type))
        throw new Error('事件类型无效');
      if (this.store.events(id).length > 20000) throw new Error('运行事件超过上限');
      const data = redact(args.data, this.secrets);
      if (Object.hasOwn(data, 'result')) {
        const preview = JSON.stringify(data.result);
        delete data.result;
        data.outputPreview =
          preview.length > 4000 ? preview.slice(0, 4000) + '…（已截断）' : preview;
      }
      this.store.tx(() => this.store.event(id, args.type, args.nodeInstance, data));
      return true;
    }
    if (method === 'state') {
      if (!['PAUSED', 'RUNNING', 'WAITING_INPUT'].includes(args.state))
        throw new Error('Worker 状态无效');
      if (args.state === 'RUNNING') this.active.controlPending = false;
      this.store.state(id, args.state);
      if (args.state === 'PAUSED' && typeof args.nodeInstance === 'string')
        this.store.event(id, 'debug-pause', args.nodeInstance, { nodeName: args.nodeName });
      if (args.message)
        this.store.tx(() => this.store.event(id, 'log', '', { message: args.message }));
      return true;
    }
    if (method === 'browser') {
      const binding = this.store.get<BrowserBinding>('browser', snapshot.bindings.browserId ?? '');
      if (!binding) throw new Error('未选择浏览器');
      const command = {
        operation: args.operation,
        selector: args.selector,
        framePath: args.framePath,
        value: args.value,
        timeoutMs: args.timeoutMs,
      };
      if (args.operation === 'upload') {
        const source = uploadSource(args.value);
        const root = await this.fileDirectory(snapshot.bindings, source.binding);
        command.value = await uploadPath(root, source.name);
      }
      if (args.operation === 'screenshot' || args.operation === 'download')
        command.value = await artifactPath(
          this.dataPath,
          id,
          args.operation === 'screenshot' ? uid() + '.png' : String(args.value),
        );
      const result = await this.sessions.use(binding, id, command, runSignal);
      if (args.operation === 'screenshot' || args.operation === 'download')
        return this.registerArtifact(id, command.value, runSignal);
      return result;
    }
    if (method === 'artifact.register') return this.registerArtifact(id, args.path, runSignal);
    if (method === 'artifact.create') {
      const path = await artifactPath(this.dataPath, id, args.name);
      await writeFile(path, args.content, { mode: 0o600 });
      return this.registerArtifact(id, path, runSignal);
    }
    if (method === 'credential') {
      if (!snapshot.bindings.credentials.includes(args.id)) throw new Error('凭据未授权给此流程');
      const secret = await this.system('credentials.get', { id: args.id });
      this.secrets.push(secret);
      return secret;
    }
    if (method === 'recruiting.policy') {
      const policy = policyOf(snapshot.bindings);
      if (!policy || policy.platform !== args.platform) throw new Error('招聘配置缺失');
      return policy;
    }
    if (method === 'recruiting.batch') {
      const policy = policyOf(snapshot.bindings);
      if (!policy || policy.platform !== args.platform) throw new Error('招聘配置缺失');
      const binding = this.store.get<BrowserBinding>('browser', snapshot.bindings.browserId ?? '');
      if (!binding) throw new Error('请先绑定本机浏览器');
      const driver = {
        perform: (command: any) => this.sessions.use(binding, id, command, runSignal),
        close: async () => {},
      };
      const site =
        policy.platform === 'boss'
          ? new BossRecruitingAdapter(driver)
          : new ZhaopinRecruitingAdapter(driver);
      const result = await this.recruiting.run({
        flowId: snapshot.id,
        policy,
        limit: args.limit,
        site,
        signal: this.active.abort.signal,
        currentPolicy: () => {
          const record = this.store.get<FlowRecord>('flow', snapshot.id);
          return record && policyOf(record.bindings);
        },
        draft: async (input, signal) => {
          if (!snapshot.bindings.credentials.includes(policy.provider))
            throw new Error('此流程未授权使用所选 AI 密钥');
          const key = await this.system('credentials.get', { id: policy.provider });
          this.secrets.push(key);
          return draftReply(input, key, signal);
        },
      });
      this.store.put('recruiting-batch', id + ':' + policy.platform, result);
      const run = this.store.get<Run>('run', id)!;
      this.store.put('run', id, {
        ...run,
        business: result.verified
          ? `批次已结束：提交 ${result.submitted}，待处理 ${result.waiting}，被阻止 ${result.blocked}；业务结果见动作记录`
          : '站点网页尚未验证，本批次未执行外发；限制已保存到待办',
      });
      return result;
    }
    if (method === 'attention') {
      const item = this.store.attention(args.kind, args.title, args.detail, args.key);
      void this.system('notification', { title: 'FlowArk 有新的待办' }).catch(() => {});
      return item;
    }
    throw new Error('Worker 方法未授权：' + method);
  }
  private async registerArtifact(runId: string, path: string, signal: AbortSignal) {
    const artifactId = uid();
    const copy = await this.artifactFiles.capture(runId, artifactId, path, signal);
    const item = { ...copy, artifactId, runId, time: now() };
    try {
      signal.throwIfAborted();
      if (this.active?.id !== runId || this.active.cancelling) throw new Error('运行已停止');
      this.store.tx(() => {
        this.store.put('artifact', artifactId, item);
        this.store.event(runId, 'artifact', '', {
          artifactId,
          name: item.name,
          size: item.size,
        });
      });
    } catch (error) {
      await this.artifactFiles.discard(copy);
      throw error;
    }
    return { artifactId, runId };
  }
  async control(id: string, action: 'pause' | 'resume' | 'step' | 'cancel') {
    const run = this.store.get<Run>('run', id);
    if (!run) throw new Error('运行不存在');
    if (terminal.has(run.state)) return false;
    if (action === 'cancel' && run.state === 'QUEUED') {
      this.store.state(id, 'CANCELLED');
      return true;
    }
    const a = this.active;
    if (!a || a.id !== id) throw new Error('运行进程不存在');
    if (action === 'cancel') {
      this.stop(a);
      return true;
    }
    this.checkActive(a);
    if (action === 'pause' && run.state !== 'RUNNING')
      throw new Error('只有运行中的任务可请求暂停');
    if (action === 'resume' && !['PAUSED', 'WAITING_INPUT'].includes(run.state))
      throw new Error('运行当前无需继续');
    if (action === 'step' && run.state !== 'PAUSED') throw new Error('只有暂停中的任务可单步执行');
    if ((action === 'step' || action === 'resume') && a.controlPending)
      throw new Error('上一次继续指令尚未处理');
    if (!a.child.connected) throw new Error('运行进程已断开');
    if (action === 'step' || action === 'resume') {
      a.controlPending = true;
      try {
        await this.system('browser.embedded.pick.cancel', {});
      } catch (error) {
        a.controlPending = false;
        throw error;
      }
      this.checkActive(a);
    }
    a.child.send({ control: action }, (error) => {
      if (error) a.rpc.close();
    });
    return true;
  }
  private skipMissed(reason: string, time = Date.now()) {
    for (const s of this.store.list<Schedule>('schedule'))
      if (s.enabled && s.nextAt <= time) {
        this.store.put('schedule-log', uid(), {
          scheduleId: s.id,
          reason,
          from: s.nextAt,
          to: time,
        });
        this.store.put('schedule', s.id, {
          ...s,
          nextAt: time + s.intervalMinutes * 60000,
        });
      }
  }
  async tick(time = Date.now()) {
    await this.ready;
    if (
      this.stopping ||
      this.suspended ||
      this.ticking ||
      this.store.fault ||
      this.executionBlock()
    )
      return;
    this.ticking = true;
    try {
      if (time - this.lastTick > 10000) this.skipMissed('sleep-or-clock-gap', time);
      this.lastTick = time;
      for (const s of this.store.list<Schedule>('schedule'))
        if (s.enabled && s.nextAt <= time) {
          if (this.executionBlock() || this.stopping || this.suspended || this.store.fault) break;
          const triggerId = s.id + ':' + s.nextAt;
          this.store.put('schedule', s.id, {
            ...s,
            nextAt: time + s.intervalMinutes * 60000,
          });
          if (
            this.store.list<Run>('run').some((r) => r.scheduleId === s.id && !terminal.has(r.state))
          )
            this.store.put('schedule-log', uid(), {
              scheduleId: s.id,
              reason: 'occupied',
              time,
            });
          else
            try {
              await this.enqueue(s.flowId, s.versionId, s.id, triggerId, s.revision);
            } catch (e) {
              this.store.put('schedule-log', uid(), {
                scheduleId: s.id,
                reason: errorText(e),
                time,
              });
            }
        }
    } finally {
      this.ticking = false;
    }
  }
  async request(method: string, args: any = {}): Promise<any> {
    switch (method) {
      case 'system.suspend': {
        this.suspended = true;
        const runs = this.store.list<Run>('run').filter((r) => !terminal.has(r.state));
        for (const run of runs) {
          this.store.event(run.id, 'system-suspend', '', {
            reason: '休眠停止运行；外部结果需核对，不自动重放',
          });
          await this.control(run.id, 'cancel');
        }
        if (runs.length) {
          this.store.attention(
            'limitation',
            '休眠已停止任务，请核对结果后重新运行',
            { runIds: runs.map((r) => r.id) },
            'suspend:' + runs.map((r) => r.id).join(','),
          );
          void this.system('notification', {}).catch(() => {});
        }
        return true;
      }
      case 'system.resume':
        this.skipMissed('system-resume');
        this.lastTick = Date.now();
        this.suspended = false;
        return true;
      case 'ai.test': {
        const input = {
          provider: args.provider,
          model: args.model,
          facts: [{ id: 'skill', text: '我有三年 TypeScript 开发经验。' }],
          conversation: [{ role: 'peer' as const, text: '你好，请介绍你的开发经验。' }],
          job: '虚构的开发岗位，用于接口验证',
          contextHash: 'test-context',
          resumeVersion: 'fictional-v1',
        };
        const key = await this.system('credentials.get', { id: args.provider });
        const result = await draftReply(input, key, new AbortController().signal);
        const reasons = validateDraft(result, input);
        if (reasons.length) throw new Error('API 已返回，但草稿未通过校验：' + reasons.join('；'));
        this.store.put('ai-validation', args.provider, {
          provider: result.provider,
          model: result.model,
          time: now(),
          requestId: result.requestId,
          status: 'passed',
        });
        return {
          provider: result.provider,
          model: result.model,
          usage: result.usage,
        };
      }
      case 'bootstrap':
        return this.bootstrap();
      case 'flow.save':
        return this.saveFlow(args.flow, args.bindings);
      case 'flow.run':
        return this.enqueue(
          args.id,
          undefined,
          undefined,
          undefined,
          undefined,
          args.debug === true,
        );
      case 'flow.create': {
        const t = templates.find((x) => x.manifest.id === args.templateId);
        const flow = t
          ? instantiate(t)
          : ({
              ...structuredClone(example),
              id: uid(),
              name: '未命名流程',
            } as Flow);
        return this.saveFlow(flow, {
          files: {},
          credentials: [],
          ...(t ? { configuration: configureTemplate(t) } : {}),
        });
      }
      case 'run.control':
        return this.control(args.id, args.action);
      case 'run.list':
        return listRuns(this.store, args);
      case 'run.rerun.preview':
        await this.ready;
        return this.reruns.preview(args);
      case 'run.rerun.confirm': {
        const pending = this.admissions.then(async () => {
          await this.ready;
          return this.reruns.confirm(args);
        });
        this.admissions = pending.then(
          () => {},
          () => {},
        );
        return pending;
      }
      case 'run.artifacts.preview':
        return this.artifactCleanup.preview(args.id);
      case 'run.artifacts.clear':
        return this.artifactCleanup.clear(args.id, args.token, args.reviewed);
      case 'run.detail': {
        const id = args.id;
        const artifacts = await Promise.all(
          this.store
            .list<any>('artifact')
            .filter((a) => a.runId === id)
            .map(async (a) => ({ ...a, ...(await this.artifactFiles.inspect(a)) })),
        );
        // Artifact inspection may span a Run finishing and the FIFO starting its
        // successor. Re-read all historical facts after that asynchronous work.
        const snapshot = this.store.get('snapshot', id);
        return {
          run: this.store.get('run', id),
          rerun: this.reruns.details(id),
          artifactCleanup: this.artifactCleanup.status(id),
          events: this.store.events(id),
          artifacts,
          output: redact(this.store.get('output', id)),
          snapshot: snapshot?.flow,
          scriptBundles: snapshot?.scriptBundles ?? [],
          fault: this.store.fault,
          execution: this.observeExecution(),
        };
      }
      case 'artifact.resolve': {
        const item = this.store.get<any>('artifact', args.id);
        if (!item) throw new Error('产物不存在');
        const status = await this.artifactFiles.inspect(item, true);
        if (!status.available)
          throw new Error(
            status.integrity === 'cleared'
              ? '产物已清理，无法定位'
              : status.integrity === 'changed'
                ? '产物副本内容已改动，无法核对当时结果'
                : '产物文件已移动、删除或不可访问',
          );
        return item.path;
      }
      case 'browser.embedded.enable': {
        const b = await this.system('browser.embedded.binding', {});
        this.store.put('browser', b.id, b);
        return b;
      }
      case 'browser.embedded.visibility':
        if (args.visible && this.executionBlock()) throw new Error(this.executionBlock());
        return this.sessions.embeddedVisibility(args.visible);
      case 'browser.embedded.pick.start':
      case 'browser.embedded.pick.validate': {
        if (this.executionBlock()) throw new Error(this.executionBlock());
        if (this.active) {
          const run = this.store.get<Run>('run', this.active.id);
          if (
            !run ||
            !['PAUSED', 'WAITING_INPUT'].includes(run.state) ||
            this.active.controlPending
          )
            throw new Error('请先暂停当前任务，再选取或验证元素');
        }
        return this.system(method, args);
      }
      case 'browser.embedded.pick.status':
      case 'browser.embedded.pick.cancel':
        return this.system(method, args);
      case 'browser.embedded.navigate': {
        if (this.executionBlock()) throw new Error(this.executionBlock());
        if (this.active) {
          const run = this.store.get<Run>('run', this.active.id);
          if (!run || !['PAUSED', 'WAITING_INPUT'].includes(run.state))
            throw new Error('请先暂停当前任务，再切换网页');
        }
        return this.system('browser.embedded.navigate', args);
      }
      case 'system.browserLost': {
        const owner = this.sessions.embeddedLost(args);
        if (owner) {
          if (this.active?.id === owner)
            this.stop(this.active, '内置网页会话意外丢失：' + String(args.reason ?? '页面已失效'));
          this.store.attention(
            'limitation',
            '内置网页会话已关闭，请核对结果后重新调试',
            { runId: owner },
            'browser-lost:' + owner,
          );
        }
        return true;
      }
      case 'system.browserCleanupFailed': {
        // Main must be free to finish its own close handler. Never await a
        // session-close RPC in this notification handler (including for previews).
        const reason = '内置网页回收未确认：' + String(args.error ?? '未取得销毁确认');
        this.blockExecution(reason);
        if (this.active) this.stop(this.active, reason);
        this.recordExecutionBlock(this.active?.id);
        return true;
      }
      case 'browser.embedded.status':
        return this.sessions.embeddedStatus();
      case 'browser.discover':
        return discoverBrowsers();
      case 'script.package.inspect':
        return inspectScriptPackage(args.path);
      case 'browser.bind': {
        const b = await inspectBrowser(args.path, args.driver);
        this.store.put('browser', b.id, b);
        return b;
      }
      case 'schedule.save': {
        args = scheduleCreateSchema.parse(args);
        await this.ready;
        this.assertAdmitting();
        const r = this.store.get<FlowRecord>('flow', args.flowId);
        if (!r) throw new Error('流程不存在');
        const prepared = await this.preflight(r);
        this.assertAdmitting();
        new Intl.DateTimeFormat('en', { timeZone: args.timezone });
        const s = {
          id: uid(),
          flowId: r.id,
          versionId: this.version(r, prepared),
          intervalMinutes: args.intervalMinutes,
          timezone: args.timezone,
          enabled: true,
          nextAt: Date.now() + args.intervalMinutes * 60000,
          revision: uid(),
        };
        this.store.put('schedule', s.id, s);
        return s;
      }
      case 'schedule.update': {
        const update = scheduleUpdateSchema.parse(args);
        await this.ready;
        this.assertAdmitting();
        const previous = this.store.get<Schedule>('schedule', update.id);
        if (!previous) throw new Error('计划不存在');
        if ((previous.revision ?? null) !== update.revision)
          throw new Error('计划已改变，请取消编辑后重新核对');
        const originalPlan = digest(previous);
        let record: FlowRecord | undefined;
        let prepared: PreparedScripts | undefined;
        if (update.adoptLatest) {
          record = this.store.get<FlowRecord>('flow', previous.flowId);
          if (!record || record.updatedAt !== update.flowUpdatedAt)
            throw new Error('已保存的流程已改变，请取消编辑后重新核对');
          const originalFlow = digest(record);
          prepared = await this.preflight(record);
          this.assertAdmitting();
          const currentFlow = this.store.get<FlowRecord>('flow', previous.flowId);
          if (!currentFlow || digest(currentFlow) !== originalFlow)
            throw new Error('已保存的流程已改变，请取消编辑后重新核对');
        }
        const current = this.store.get<Schedule>('schedule', update.id);
        if (!current || digest(current) !== originalPlan)
          throw new Error('计划已改变，请取消编辑后重新核对');
        // Version publication and plan replacement are one synchronous transaction.
        // Existing Run snapshots and the plan's enabled state are never rewritten.
        return this.store.tx(() => {
          const next: Schedule = {
            ...current,
            versionId: record && prepared ? this.version(record, prepared) : current.versionId,
            intervalMinutes: update.intervalMinutes,
            timezone: update.timezone,
            nextAt: Date.now() + update.intervalMinutes * 60000,
            revision: uid(),
          };
          this.store.put('schedule', next.id, next);
          return next;
        });
      }
      case 'schedule.toggle': {
        if (args.enabled) {
          await this.ready;
          this.assertAdmitting();
        }
        const s = this.store.get<Schedule>('schedule', args.id);
        if (!s) throw new Error('计划不存在');
        this.store.put('schedule', s.id, {
          ...s,
          enabled: args.enabled,
          nextAt: Date.now() + s.intervalMinutes * 60000,
          revision: uid(),
        });
        return true;
      }
      case 'attention.read': {
        const a = this.store.get<any>('attention', args.id);
        if (a) this.store.put('attention', a.id, { ...a, read: true });
        return true;
      }
      case 'action.confirm': {
        const a = this.store.get<PreparedAction>('action', args.id);
        const record = a?.flowId && this.store.get<FlowRecord>('flow', a.flowId);
        const policy = record && policyOf(record.bindings);
        if (!policy) throw new Error('原流程或招聘配置不存在');
        this.recruiting.actions.confirm(args.id, policy, args.policyHash);
        return true;
      }
      case 'flow.export': {
        const request = flowExportSchema.parse(args);
        const f = structuredClone(validateFlow(request.flow));
        f.parameters = Object.fromEntries(Object.keys(f.parameters).map((k) => [k, null]));
        const configuration =
          request.configuration &&
          validateObject<NonNullable<Template['manifest']['configuration']>>(
            'TemplateConfiguration',
            request.configuration,
          );
        const content = JSON.stringify(
          validateTemplate(packageFlow(f, 'local', configuration)),
          null,
          2,
        );
        if (content.length > templateContentLimit) throw new Error('导出模板超过 2 MiB');
        return content;
      }
      case 'flow.import': {
        const p = validateTemplate(JSON.parse(args.content));
        return this.saveFlow(instantiate(p), {
          files: {},
          credentials: [],
          configuration: configureTemplate(p),
        });
      }
      case 'shutdown':
        await this.shutdown();
        return true;
      default:
        throw new Error('宿主方法未授权：' + method);
    }
  }
  async shutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    const errors: unknown[] = [];
    // Revoke every script immediately, even if SQLite rejects a subsequent
    // cancellation record or there is no longer an active Worker.
    const scriptCleanup = this.scripts.shutdown().catch(
      (error): CleanupResult => ({
        confirmed: false,
        error: '脚本退出回收失败：' + errorText(error),
      }),
    );
    try {
      for (const r of this.store.list<Run>('run'))
        if (r.state === 'QUEUED') {
          try {
            this.store.state(r.id, 'CANCELLED');
          } catch (error) {
            errors.push(error);
          }
        }
    } catch (error) {
      errors.push(error);
    }
    const active = this.active;
    if (active) {
      try {
        this.stop(active);
      } catch (error) {
        errors.push(error);
      }
      // A failed state write or browser cleanup must not skip the actual child.
      await this.stopWorker(active);
      await active.done;
    }
    let cleanup: CleanupResult;
    try {
      cleanup = await this.sessions.shutdown();
    } catch (error) {
      cleanup = { confirmed: false, error: '浏览器退出回收失败：' + errorText(error) };
    }
    if (!cleanup.confirmed) this.blockExecution(cleanup.error ?? '退出时资源回收未确认');
    const scripts = await scriptCleanup;
    if (!scripts.confirmed) this.blockExecution(scripts.error ?? '退出时脚本回收未确认');
    try {
      await this.ready;
    } catch (error) {
      errors.push(error);
    }
    try {
      this.recordExecutionBlock(active?.id);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, '退出收尾遇到本地记录错误，请重开后核对运行记录');
  }
}
