import { join, dirname } from 'node:path';
import { access, stat, writeFile, realpath } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { RecruitingCoordinator } from '../recruiting/coordinator';
import { BossRecruitingAdapter, ZhaopinRecruitingAdapter } from '../recruiting/sites';
import type { PreparedAction } from '../recruiting/actions';
import { Store } from './store';
import { Sessions } from './sessions';
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
} from '../shared/types';
const terminal = new Set(['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
type Active = {
  id: string;
  child: ChildProcess;
  rpc: Rpc;
  cancelling: boolean;
  controlPending?: boolean;
  done: Promise<void>;
  abort: AbortController;
};
export class Runtime {
  readonly store: Store;
  readonly sessions: Sessions;
  readonly recruiting: RecruitingCoordinator;
  private active?: Active;
  private artifactFiles: ArtifactFiles;
  private stopping = false;
  private suspended = false;
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
    this.recruiting = new RecruitingCoordinator(this.store, () =>
      this.system('notification', { title: 'FlowArk 有新的联系方式待办' }),
    );
    this.sessions = new Sessions(dir, executable, dataPath, system);
    if (!this.store.list('flow').length)
      this.saveFlow(validateFlow(example), { files: {}, credentials: [] });
    this.skipMissed('application-restart');
    this.timer = setInterval(
      () =>
        void this.tick().catch((e) => {
          this.store.fault = errorText(e);
        }),
      1000,
    );
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
    const id = digest({
      flow: record.flow,
      bindings: record.bindings,
      scriptBundles: prepared.scriptBundles,
    });
    if (!this.store.get('version', id))
      this.store.put('version', id, { ...record, ...prepared, versionId: id });
    return id;
  }
  async bootstrap(): Promise<Bootstrap> {
    return {
      flows: this.store
        .list<FlowRecord>('flow')
        .map((r) => ({ ...r, bindings: normalizeBindings(r.bindings) })),
      runs: this.store.list<Run>('run').reverse().slice(0, 200),
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
      credentials: await this.system('credentials.list', {}),
      fault: this.store.fault,
      dataPath: this.dataPath,
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
    if (this.suspended) throw new Error('系统正在休眠，恢复后请重新开始运行');
    if (this.stopping || this.store.fault) throw new Error(this.store.fault ?? '应用正在退出');
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
    this.assertAdmitting();
    // Capture the requested content before waiting, while serializing admission
    // so a cheap second preflight cannot overtake the first manual request.
    const record = this.store.get<FlowRecord>(versionId ? 'version' : 'flow', versionId ?? flowId);
    if (!record) throw new Error('流程或版本不存在');
    const pending = this.admissions.then(() =>
      this.admit(record, flowId, versionId, scheduleId, triggerId, scheduleRevision, debug),
    );
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
      this.store.fault = '运行状态无法可靠保存，已停止接收新任务；请保留数据并重启后核对';
    });
  }
  private async pump() {
    if (this.active || this.stopping || this.suspended || this.store.fault) return;
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
    proc.on('exit', () => rpc.close());
    proc.on('error', () => rpc.close());
    try {
      this.store.state(run.id, 'RUNNING');
      const s = this.store.get<FlowRecord & PreparedScripts>('snapshot', run.id)!;
      const prepared = await this.preflight(s); // Revalidate resources, never recompile a fixed bundle.
      const outputs = await rpc.call(
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
      if (active.cancelling) throw new Error('取消');
      this.store.put('output', run.id, redact(outputs, this.secrets));
      await this.sessions.release(run.id);
      await killOwnedTree(proc);
      this.store.state(run.id, 'SUCCEEDED');
    } catch (e) {
      // Capture loss before our own cleanup kills an otherwise healthy worker.
      const lost = proc.exitCode !== null || proc.signalCode !== null;
      active.abort.abort(new Error('运行已停止'));
      await this.sessions.release(run.id, true);
      await killOwnedTree(proc);
      const old = this.store.get<Run>('run', run.id);
      if (old && !terminal.has(old.state))
        this.store.state(
          run.id,
          active.cancelling ? 'CANCELLED' : lost ? 'INTERRUPTED' : 'FAILED',
          {
            error: redact(errorText(e), this.secrets),
            business: '若含外部提交，请核对结果；不会自动重试',
          },
        );
    } finally {
      rpc.close();
      this.secrets = [];
      if (this.active === active) this.active = undefined;
      settled();
      if (!this.stopping && !this.store.fault) this.dispatch();
    }
  }
  private async workerRequest(id: string, method: string, args: any): Promise<any> {
    if (this.active?.id !== id || this.active.cancelling) throw new Error('运行已停止');
    const runSignal = this.active.abort.signal;
    const snapshot = this.store.get<FlowRecord>('snapshot', id)!;
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
      if (a.cancelling) return true;
      a.cancelling = true;
      a.abort.abort(new Error('用户取消'));
      this.store.state(id, 'CANCELLING');
      if (a.child.connected)
        a.child.send({ control: 'cancel' }, (error) => {
          if (error) a.rpc.close();
        });
      await this.sessions.release(id, true);
      setTimeout(() => void killOwnedTree(a.child), 2000).unref();
      return true;
    }
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
      if (a.cancelling || this.active !== a) throw new Error('运行已停止');
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
    if (this.stopping || this.suspended || this.ticking || this.store.fault) return;
    this.ticking = true;
    try {
      if (time - this.lastTick > 10000) this.skipMissed('sleep-or-clock-gap', time);
      this.lastTick = time;
      for (const s of this.store.list<Schedule>('schedule'))
        if (s.enabled && s.nextAt <= time) {
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
      case 'run.detail':
        return {
          run: this.store.get('run', args.id),
          events: this.store.events(args.id),
          artifacts: await Promise.all(
            this.store
              .list<any>('artifact')
              .filter((a) => a.runId === args.id)
              .map(async (a) => ({ ...a, ...(await this.artifactFiles.inspect(a)) })),
          ),
          output: redact(this.store.get('output', args.id)),
          snapshot: this.store.get('snapshot', args.id)?.flow,
          scriptBundles: this.store.get('snapshot', args.id)?.scriptBundles ?? [],
        };
      case 'artifact.resolve': {
        const item = this.store.get<any>('artifact', args.id);
        if (!item) throw new Error('产物不存在');
        const status = await this.artifactFiles.inspect(item, true);
        if (!status.available)
          throw new Error(
            status.integrity === 'changed'
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
        return this.sessions.embeddedVisibility(args.visible);
      case 'browser.embedded.pick.start':
      case 'browser.embedded.pick.validate': {
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
        if (this.active) {
          const run = this.store.get<Run>('run', this.active.id);
          if (!run || !['PAUSED', 'WAITING_INPUT'].includes(run.state))
            throw new Error('请先暂停当前任务，再切换网页');
        }
        return this.system('browser.embedded.navigate', args);
      }
      case 'system.browserLost': {
        const owner = this.sessions.embeddedLost(args.token);
        if (owner) {
          this.store.attention(
            'limitation',
            '内置网页会话已关闭，请核对结果后重新调试',
            { runId: owner },
            'browser-lost:' + owner,
          );
          await this.control(owner, 'cancel');
        }
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
        this.assertAdmitting();
        const r = this.store.get<FlowRecord>('flow', args.flowId);
        if (!r) throw new Error('流程不存在');
        const prepared = await this.preflight(r);
        this.assertAdmitting();
        new Intl.DateTimeFormat('en', { timeZone: args.timezone });
        const s = {
          id: args.id ?? uid(),
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
      case 'schedule.toggle': {
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
        const r = this.store.get<FlowRecord>('flow', args.id);
        if (!r) throw new Error('流程不存在');
        const f = structuredClone(r.flow);
        f.parameters = Object.fromEntries(Object.keys(f.parameters).map((k) => [k, null]));
        const config = r.bindings.configuration;
        return JSON.stringify(
          packageFlow(f, 'local', config && { adapter: config.adapter, schema: config.schema }),
          null,
          2,
        );
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
    for (const r of this.store.list<Run>('run'))
      if (r.state === 'QUEUED') this.store.state(r.id, 'CANCELLED');
    if (this.active) {
      const a = this.active;
      await this.control(a.id, 'cancel');
      await killOwnedTree(a.child);
      await a.done;
    }
    await this.sessions.shutdown();
  }
}
