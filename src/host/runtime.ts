import { EntryHandoffs } from './entry-handoff';
import { handoffMethods, type HandoffSelection } from '../shared/entry-handoff';
import { AuthorSdk } from './author-sdk';
import { methods } from '../shared/ipc';
import {
  assertBrowserInspectionNode,
  assertBrowserInspectionResult,
  browserInspectionCapability,
} from '../shared/browser-inspection';
import { TemplateAuthor } from './template-author';
import { authorMethods } from '../shared/template-author';
import { TemplateData } from './template-data';
import { dataMethods } from '../shared/template-data';
import { TypedResults } from './typed-results';
import { Skills } from './skills';
import { skillMethods, skillBinding } from '../shared/skill';
import { trialMethods } from '../shared/skill-trial';
import { Conversations } from './conversations';
import { DocumentProcesses } from './document-processes';
import { conversationMethods } from '../shared/conversation';
import { AINodes } from './ai-nodes';
import { aiProviders } from '../shared/ai-node';
import { resolveParameterSources } from '../shared/parameter-sources';
import { toolSecretValues } from '../shared/mcp-oauth-grant';
import { redactMcpReceipt } from './mcp-redaction';
import { McpRuns } from './mcp-runs';
import { templateSourceSchema, type TemplateSource } from '../shared/template-source';
import { inspectSchedule } from './schedule-inspection';
import { Learning } from './learning';
import { learningPrompt } from '../shared/learning';
import { exportDefinition } from '../templates/export';
import { writeArchive } from '../templates/archive';
import { join, dirname } from 'node:path';
import { access, stat, writeFile, realpath } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { Store } from './store';
import { scheduleCreateSchema, scheduleUpdateSchema } from '../shared/schedules';
import { flowExportSchema, templateContentLimit } from '../shared/flow-export';
import { listRuns, runOverview } from './run-history';
import { ArtifactCleanup } from './artifact-cleanup';
import { RunRerun, executionVersion } from './run-rerun';
import { RunReview } from './run-review';
import { runTargetContext } from './run-target-context';
import { Sessions } from './sessions';
import { ScriptProcesses } from './script-processes';
import { ScriptProcessInterruptedError, type ScriptOwner } from '../shared/script-supervision';
import type { CleanupResult } from '../shared/embedded-lifecycle';
import { child, killOwnedTree } from './processes';
import { Rpc } from '../shared/rpc';
import {
  uid,
  now,
  digest,
  canonical,
  errorText,
  redact,
  redactArtifactText,
  redactedErrorText,
} from '../shared/utils';
import { validateFlow, validateObject, walk } from '../core/validate';
import { assertBrowserOperations } from '../adapters/browser-scope';
import { discoverBrowsers, inspectBrowser, validateBinding } from '../adapters/browsers';
import { compileScript, inspectScriptPackage, verifyScriptBundle } from '../adapters/script-bundle';
import { ArtifactFiles } from '../adapters/artifacts';
import { artifactPath, scopedTarget, uploadPath } from '../adapters/files';
import { staticUploadFields, uploadSource, uploadText } from '../shared/upload-source';
import { Templates } from '../templates/service';
import { version as clientVersion } from '../../package.json';
import { normalizeBindings, validateConfiguration } from './configuration';
const example = {
  formatVersion: '1.0',
  id: 'empty',
  name: '未命名流程',
  description: '',
  parameters: {},
  steps: [],
  requiredCapabilities: [],
} as Flow;
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
  ExecutionObservation,
} from '../shared/types';
import { DesktopPlanning } from './desktop-planning';
import { DesktopRuns } from './desktop-runs';
import { Planning } from './planning';
import { PlanningRepair } from './planning-repair';
import { TaskWebTargets } from './task-web-target';
const terminal = new Set(['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
type Active = {
  nodeInstances?: Set<string>;
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
import { TaskOutputs } from './task-output';
import { TaskAttachments } from './task-attachments';
import { TaskMcpTargets } from './task-mcp-targets';
import { ToolConnections } from './tool-connections';
import { AISettings } from './ai-settings';
import { LocalCredentialSettings } from './local-credentials';

export class Runtime {
  readonly store: Store;
  readonly sessions: Sessions;
  readonly scripts: ScriptProcesses;
  readonly ready: Promise<void>;
  readonly templates: Templates;
  readonly planning: Planning;
  readonly desktopPlanning: DesktopPlanning;
  readonly desktopRuns: DesktopRuns;
  readonly mcpRuns: McpRuns;
  readonly learning: Learning;
  readonly webTargets: TaskWebTargets;
  readonly outputs: TaskOutputs;
  readonly toolConnections: ToolConnections;
  readonly toolTargets: TaskMcpTargets;
  readonly aiSettings: AISettings;
  readonly localCredentials: LocalCredentialSettings;
  private credentialChecks = new WeakMap<PreparedScripts, () => void>();
  private active?: Active;
  private handoffId?: string;
  private handoffNextRun?: string;
  private handoffs: EntryHandoffs;
  private artifactFiles: ArtifactFiles;
  private artifactCleanup: ArtifactCleanup;
  private reruns: RunRerun;
  private runReview: RunReview;
  private pendingCapabilities = new Map<string, number>();
  private stopping = false;
  private suspended = false;
  private admissionEpoch = 0;
  private suspension?: Promise<boolean>;
  private runtimeBlock?: string;
  private recovering = true;
  private ticking = false;
  private lastTick = Date.now();
  private timer?: NodeJS.Timeout;
  private secrets: string[] = [];
  private conversations: Conversations;
  private documents: DocumentProcesses;
  private skills: Skills;
  private typedResults: TypedResults;
  private author: TemplateAuthor;
  private templateData: TemplateData;
  private authorSdk: AuthorSdk;
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
    this.typedResults = new TypedResults(this.store);
    this.documents = new DocumentProcesses(dir, executable);
    this.skills = new Skills(this.store, {
      available: () => this.assertAdmitting(),
      notify: () => this.system('notification', { title: 'FlowArk 有待核对的Skill草稿' }),
      verifyConversation: (evidence) => this.conversations.verifyEvidence(evidence),
    });
    this.conversations = new Conversations(this.store, {
      available: () => this.assertAdmitting(),
      configuration: (provider) => this.system('ai.configuration.read', { provider }),
      key: (provider, revision) => this.system('credentials.get', { id: provider, revision }),
      publish: (event) => this.system('conversation.message', event),
      notify: () => this.system('notification', { title: 'FlowArk 有新的引导会话' }),
      trialStatus: (source) => this.skills.trialStatus(source),
      trialUnchanged: (source) => this.skills.trialUnchanged(source),
    });
    this.aiSettings = new AISettings(this.store, {
      assertAvailable: () => {
        if (this.stopping || this.suspended) throw new Error('应用正在退出或休眠');
        if (this.store.fault) throw new Error(this.store.fault);
      },
      inUse: (provider) =>
        this.planning?.usesProvider(provider) ||
        this.desktopPlanning?.usesProvider(provider) ||
        this.conversations?.usesProvider(provider) ||
        this.store.list<Run>('run').some(
          (run) =>
            (run.id === this.active?.id || run.state === 'QUEUED') &&
            (() => {
              const snapshot = this.store.get<FlowRecord>('snapshot', run.id);
              return (
                !!snapshot &&
                (snapshot.bindings.credentials.includes(provider) ||
                  aiProviders(snapshot).includes(provider))
              );
            })(),
        ),
      get: (provider) => this.system('ai.configuration.read', { provider }),
      change: (provider, revision, update) =>
        this.system('ai.configuration.write', { provider, revision, update }),
      key: (provider, revision) => this.system('credentials.get', { id: provider, revision }),
    });
    this.localCredentials = new LocalCredentialSettings({
      assertAvailable: () => {
        if (this.stopping || this.suspended) throw new Error('应用正在退出或休眠');
        if (this.store.fault || this.executionBlock())
          throw new Error('本地存储或运行资源尚未就绪，请先处理故障');
      },
      inUse: (id) =>
        this.store
          .list<Run>('run')
          .some(
            (run) =>
              (run.id === this.active?.id || run.state === 'QUEUED') &&
              this.store.get<FlowRecord>('snapshot', run.id)?.bindings.credentials.includes(id),
          ),
      boundFlows: (id) =>
        this.store
          .list<FlowRecord>('flow')
          .filter((flow) => flow.bindings.credentials.includes(id))
          .map((flow) => ({ id: flow.id, name: flow.flow.name })),
      list: () => this.system('credential.local.read', {}),
      change: (id, revision, update) =>
        this.system('credential.local.write', { id, revision, update }),
    });
    this.toolConnections = new ToolConnections(this.store, {
      openOAuth: (url) => this.system('tool.oauth.open', { url }),
      assertAvailable: () => {
        if (this.stopping || this.suspended) throw new Error('应用正在退出或休眠');
        if (this.store.fault) throw new Error(this.store.fault);
      },
      credentials: {
        get: async (id) => {
          const secret = await this.system('tool.credentials.get', { id });
          if (typeof secret === 'string' && secret) this.secrets.push(...toolSecretValues(secret));
          return secret;
        },
        set: (id, value) => {
          this.secrets.push(...toolSecretValues(value));
          return this.system('tool.credentials.set', { id, value });
        },
        remove: (id) => this.system('tool.credentials.remove', { id }),
      },
    });
    this.webTargets = new TaskWebTargets(this.store, {
      page: () => this.system('browser.embedded.review', {}),
      captureElement: (requestId) =>
        this.system('browser.embedded.task-element.capture', { requestId }),
      verifyElement: (page, element) =>
        this.system('browser.embedded.task-element.verify', { page, element }),
      assertSelectable: () => {
        this.assertAdmitting();
        if (this.active || this.store.list<Run>('run').some((r) => r.state === 'QUEUED'))
          throw new Error('请等待当前运行和收尾结束后，再选择网页对象');
      },
    });
    this.outputs = new TaskOutputs(this.store, {
      choose: () => this.system('task.output.directory', {}),
      assertSelectable: (task) => {
        this.assertAdmitting();
        const active = this.active && this.store.get<Run>('run', this.active.id);
        if (
          (active && active.flowId === task.flowId) ||
          this.store.list<Run>('run').some((r) => r.flowId === task.flowId && r.state === 'QUEUED')
        )
          throw new Error('请等待本任务运行和收尾结束，再更换输出');
      },
    });
    this.toolTargets = new TaskMcpTargets(this.store, this.toolConnections, (task) => {
      this.assertAdmitting();
      const active = this.active && this.store.get<Run>('run', this.active.id);
      if (
        (active && active.flowId === task.flowId) ||
        this.store
          .list<Run>('run')
          .some((run) => run.flowId === task.flowId && run.state === 'QUEUED')
      )
        throw new Error('请等待本任务运行和收尾结束，再更换工具对象');
    });
    this.mcpRuns = new McpRuns(this.store, this.toolConnections, this.toolTargets, (value) =>
      redactMcpReceipt(value, this.secrets),
    );
    this.learning = new Learning(this.store, {
      busy: (id) => {
        const task = this.store.get('ai-task', id);
        const active = this.active && this.store.get<Run>('run', this.active.id);
        return !!active && (active.task?.id === id || active.flowId === task?.flowId);
      },
      create: () => this.planning.create(undefined, learningPrompt),
      detail: (id) => this.planning.detail(id),
      assertAvailable: () => {
        if (this.stopping || this.suspended) throw new Error('应用正在退出或休眠');
        if (this.store.fault) throw new Error(this.store.fault);
      },
    });
    this.planning = new Planning(this.store, {
      tools: this.toolTargets,
      attachments: new TaskAttachments(this.store, {
        choose: (kind) => this.system('task.attachment.file', { kind }),
        decodeImage: (data) => this.system('task.attachment.image.validate', { data }),
      }),
      learning: this.learning,
      web: this.webTargets,
      output: this.outputs,
      repair: new PlanningRepair(this.store, {
        epoch: () => this.admissionEpoch,
        assertAvailable: () => {
          if (this.executionBlock()) throw new Error(this.executionBlock());
          if (
            this.stopping ||
            this.suspended ||
            this.active ||
            this.store.list<Run>('run').some((r) => r.state === 'QUEUED')
          )
            throw new Error('请等待当前运行和收尾结束后，再检查目标修复');
        },
        capture: (requestId) => this.system('browser.embedded.pick.capture', { requestId }),
      }),
      key: async (provider) => {
        this.aiSettings.assertReadable(provider);
        const key = await this.system('credentials.get', { id: provider });
        this.aiSettings.assertReadable(provider);
        return key;
      },
      save: (flow, bindings) => this.saveFlow(flow, bindings),
      assertAvailable: () => {
        if (this.stopping || this.suspended)
          throw new Error('应用正在退出或休眠，不能开始新的规划操作');
        if (this.store.fault) throw new Error(this.store.fault);
      },
    });
    this.desktopPlanning = new DesktopPlanning({
      task: (id) => this.planning.detail(id).task,
      assertAvailable: () => {
        if (this.stopping || this.suspended || this.store.fault)
          throw new Error('应用或存储尚未就绪');
      },
      configuration: (provider) => this.system('ai.configuration.read', { provider }),
      key: (provider, revision) => this.system('credentials.get', { id: provider, revision }),
      captureConfiguration: (provider) => this.aiSettings.capture([provider]),
      selection: (reference) => this.system('desktop.selection.resolve', reference),
      inspect: (reference) => this.system('desktop.selection.inspect', reference),
      adopt: (candidate, original) => this.planning.adoptDesktop(candidate, original),
    });
    this.desktopRuns = new DesktopRuns(this.store, {
      system: (method, args) => this.system(method, args),
      detail: (id) => this.planning.detail(id),
      available: () => {
        if (this.stopping || this.suspended || this.store.fault)
          throw new Error('应用或存储尚未就绪');
      },
      idle: () => {
        if (this.active || this.store.list<Run>('run').some((run) => run.state === 'QUEUED'))
          throw new Error('请等待当前运行结束后重新绑定应用窗口');
      },
    });
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
      assertAdmitting: () => {
        this.assertAdmitting();
        this.assertNoHandoff();
      },
      busy: (id) =>
        this.active?.id === id ||
        this.scripts.hasRun(id) ||
        (this.pendingCapabilities.get(id) ?? 0) > 0,
      preflight: (record) => this.preflight(record),
      version: (record, prepared) => this.version(record, prepared),
      dispatch: () => this.dispatch(),
    });
    this.templates = new Templates(this.store, dataPath, clientVersion, () =>
      this.system('notification', { title: 'FlowArk 有新的待办' }),
    );
    this.templateData = new TemplateData(this.store, {
      available: () => this.assertAdmitting(),
      formal: (record) => this.templates.context(record),
      authorize: (record, runId, signal) => {
        const live = this.store.get<any>('template-instance', record.bindings.template!.instanceId);
        if (!live) throw Error('模板实例不存在');
        return this.templates.canWrite(
          { ...record, bindings: { ...record.bindings, grants: live.grants } },
          runId,
          signal,
        );
      },
    });
    this.authorSdk = new AuthorSdk(
      this.store,
      () => this.assertAdmitting(),
      () => this.system('notification', { title: 'FlowArk 有新的作者调试提醒' }),
    );
    this.author = new TemplateAuthor(
      this.store,
      this.templates.library,
      () => this.assertAdmitting(),
      this.templateData,
      this.authorSdk,
    );
    this.sessions = new Sessions(dir, executable, dataPath, system);
    this.runReview = new RunReview(this.store, {
      desktop: this.desktopRuns,
      tools: (record) => this.toolTargets.reviewStates(record),
      learnedTrial: (run) => this.learning.trial(run),
      busy: (id) =>
        this.active?.id === id ||
        this.scripts.hasRun(id) ||
        (this.pendingCapabilities.get(id) ?? 0) > 0,
      target: (selection) => this.system('browser.embedded.target.verify', { selection }),
      assertAdmitting: () => {
        this.assertAdmitting();
        this.assertNoHandoff();
      },
      epoch: () => this.admissionEpoch,
      preflight: (record) => this.preflight(record, true),
      version: (record, prepared) => this.version(record, prepared),
      dispatch: () => this.dispatch(),
      embedded: () => this.system('browser.embedded.review', {}),
      template: async (record) => {
        const { pkg, entry } = await this.templates.context(record);
        return {
          resources: pkg.manifest.resources.filter((r) => entry.resources.includes(r.id)),
          actions: pkg.manifest.actions.filter((a) => entry.actions.includes(a.id)),
        };
      },
      error: (error) => this.redactError(error),
    });
    this.handoffs = new EntryHandoffs(this.store, {
      available: () => this.assertAdmitting(),
      epoch: () => this.admissionEpoch,
      capture: (selection) => this.handoffScope(selection),
      prepare: async (record) => {
        await this.preflight(record);
      },
      package: async (record) => {
        const { pkg } = await this.templates.context(record);
        return { version: pkg.manifest.version, digest: pkg.manifest.contentDigest };
      },
      reserve: (id) => {
        this.assertNoHandoff();
        this.handoffId = id;
        this.admissionEpoch++;
      },
      release: (id) => {
        if (this.handoffId === id) this.handoffId = undefined;
        this.dispatch();
      },
      stop: (ids) => this.stopHandoffRuns(ids),
      create: async (record, selection, id) => {
        this.templates.assertSource(selection.flowId, selection.source);
        const run = await this.admit(
          this.admissionEpoch,
          record,
          selection.flowId,
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          selection.source,
          id,
        );
        this.handoffNextRun = run.id;
        return run;
      },
      error: (error) => this.redactError(error),
    });
    this.ready = Promise.all([this.scripts.ready, this.templates.library.cleanStaging()]).then(
      () => {
        // A recovery probe can take several seconds. Plans missed during that
        // interval are skipped before any timer or queued admission can proceed.
        this.skipMissed('application-restart');
        this.lastTick = Date.now();
        this.templateData.recover();
        this.handoffs.recover();
        this.recovering = false;
        if (!this.stopping)
          this.timer = setInterval(
            () => void this.tick().catch((e) => (this.store.fault = this.redactError(e))),
            1000,
          );
      },
    );
    // Keep direct Runtime users from producing an unhandled rejection while
    // preserving the rejected ready promise for init and execution admission.
    void this.ready.catch((error) => {
      this.recovering = false;
      this.store.fault ??= '脚本资源恢复核对失败：' + this.redactError(error);
    });
  }
  private aiNodes = new AINodes({
    outcomeReceipt: (runId, instance, receipt) => {
      this.store.aiOutcome(runId, instance, receipt, this.secrets);
    },
    configuration: (provider) => this.system('ai.configuration.read', { provider }),
    key: (provider, revision) => this.system('credentials.get', { id: provider, revision }),
    secret: (key) => {
      this.secrets.push(key);
    },
    receipt: (runId, instance, result) =>
      this.store.event(
        runId,
        'ai-result',
        instance,
        redact(
          {
            provider: result.provider,
            model: result.model,
            requestId: result.requestId,
            usage: result.usage,
          },
          this.secrets,
        ),
      ),
  });
  redactError(error: unknown): string {
    return redactedErrorText(error, this.secrets);
  }
  saveFlow(flow: Flow, bindings: Bindings): FlowRecord {
    const previous = this.store.get<FlowRecord>('flow', flow.id);
    if (previous?.bindings.template) {
      if (canonical(bindings) !== canonical(previous.bindings))
        throw new Error('模板实例资源与授权请在实例配置中修改');
      if (
        canonical(flow.parameters) !== canonical(previous.flow.parameters) ||
        canonical(flow.parameterSources) !== canonical(previous.flow.parameterSources)
      )
        throw new Error('模板入口参数请在实例操作入口中修改；来源表达式由模板定义');
      bindings = previous.bindings;
    } else if (bindings.template) throw new Error('不能伪造模板实例绑定');
    bindings = normalizeBindings(bindings);
    validateConfiguration(bindings);
    if (bindings.configuration?.adapter === 'flow-parameters-v1')
      flow = { ...flow, parameters: bindings.configuration.values as any };
    validateFlow(flow);
    const record = {
      ...(previous?.webTarget ? { webTarget: previous.webTarget } : {}),
      ...(previous?.outputTarget ? { outputTarget: previous.outputTarget } : {}),
      ...(previous?.toolTargets ? { toolTargets: previous.toolTargets } : {}),
      id: flow.id,
      flow: structuredClone(flow),
      bindings: structuredClone(bindings),
      updatedAt: now(),
    };
    for (const id of bindings.credentials) this.localCredentials.assertReadable(id);
    this.store.put('flow', flow.id, record);
    return record;
  }
  private version(record: FlowRecord, prepared: PreparedScripts) {
    this.credentialChecks.get(prepared)?.();
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
      attention: this.store.list<any>('attention').reverse(),
      templates: this.templates.list(),
      instances: this.templates.instances(),
      credentials,
      fault: this.store.fault ? redact(this.store.fault, this.secrets) : undefined,
      runtimeBlock: this.executionBlock(),
      dataPath: this.dataPath,
      execution: this.observeExecution(),
    };
  }
  async preflight(
    record: FlowRecord & Partial<PreparedScripts>,
    desktopRun?: string | true,
  ): Promise<PreparedScripts> {
    const checkAI = this.aiSettings.capture([
      ...record.bindings.credentials,
      ...aiProviders(record),
    ]);
    const checkLocal = this.localCredentials.capture(record.bindings.credentials);
    const checkCredentials = () => {
      this.toolTargets.assertExecutable(record.id, record, !!desktopRun);
      checkAI();
      checkLocal();
    };
    const checked = (prepared: PreparedScripts) => {
      checkCredentials();
      this.credentialChecks.set(prepared, checkCredentials);
      return prepared;
    };
    this.toolTargets.assertExecutable(record.id, record, !!desktopRun);
    const validatedFlow = validateFlow(record.flow);
    const authorSdk = this.authorSdk.prepare(record);
    const templateData = await this.templateData.prepare(record);
    const flow = { ...validatedFlow, parameters: resolveParameterSources(validatedFlow) };
    if (walk(flow.steps).some((node) => node.type === 'desktop')) {
      if (!desktopRun) throw new Error('应用选区只能从原任务重新绑定窗口并明确确认单次试运行');
      await this.desktopRuns.verify(
        record,
        typeof desktopRun === 'string' ? desktopRun : undefined,
      );
    }
    if (walk(flow.steps).some((node) => node.type === 'mcp')) {
      if (!desktopRun) throw new Error('请从原任务核对工具并明确确认本次试运行');
      const run =
        typeof desktopRun === 'string' ? this.store.get<Run>('run', desktopRun) : undefined;
      if (typeof desktopRun === 'string' && !run) throw new Error('工具运行授权不存在');
      this.mcpRuns.verify(record, run);
    }
    const localIds = record.bindings.credentials.filter((id) => id.startsWith('local-'));
    if (localIds.length) await this.system('credential.local.check', { ids: localIds });
    this.toolTargets.assertExecutable(record.id, record, !!desktopRun);
    await this.webTargets.record(record);
    await this.outputs.record(record);
    await this.templates.preflight(record);
    await this.aiNodes.preflight(record);
    await this.aiNodes.preflightConversations(record);
    if (record.bindings.template) {
      const { entry, pkg } = await this.templates.context(record);
      for (const resource of pkg.manifest.resources.filter(
        (r) => r.kind === 'skill' && entry.resources.includes(r.id),
      )) {
        if (!record.bindings.resources?.[resource.id] && !resource.required) continue;
        const b = skillBinding(record.bindings, resource.id);
        await this.skills.read(b.path, b.skill);
      }
    }
    const skillSnapshots = await this.skills.snapshot(record, record.skillSnapshots);
    const steps = walk(flow.steps);
    if (steps.some((n) => n.type === 'browser')) {
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
      if (
        n.type === 'file' ||
        n.type === 'excel' ||
        n.type === 'document' ||
        (n.type === 'skill' && n.operation === 'propose')
      )
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
      this.toolTargets.assertExecutable(record.id, record, !!desktopRun);
      await this.webTargets.record(record);
      await this.outputs.record(record);
      return checked({
        scripts: record.scripts,
        scriptBundles: record.scriptBundles,
        skillSnapshots,
        templateData,
        authorSdk,
      });
    }
    if (record.versionId && scriptNodes.some((n) => n.dependencies.length))
      throw new Error('旧计划没有固定脚本依赖，请重新保存计划');
    const prepared: PreparedScripts = {
      scripts: {},
      scriptBundles: [],
      skillSnapshots,
      templateData,
      authorSdk,
    };
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
    this.toolTargets.assertExecutable(record.id, record, !!desktopRun);
    await this.webTargets.record(record);
    await this.outputs.record(record);
    return checked(prepared);
  }
  private assertNoHandoff(owner?: string) {
    if (this.handoffId && this.handoffId !== owner)
      throw Error('正在停止本实例后执行入口，请先核对原请求');
  }
  private handoffScope(selection: HandoffSelection) {
    this.templates.assertSource(selection.flowId, selection.source);
    const record = this.store.get<FlowRecord>('flow', selection.flowId),
      instance = this.store.get<any>('template-instance', selection.source.instanceId);
    if (!record || !instance) throw Error('模板入口或实例不存在');
    const belongs = (id: string) =>
      this.store.get<FlowRecord>('snapshot', id)?.bindings.template?.instanceId === instance.id;
    if (this.active && !belongs(this.active.id))
      throw Error('其他实例或流程正在运行，请等待结束；不会停止它');
    const runs = this.store.list<Run>('run').filter((r) => !terminal.has(r.state) && belongs(r.id));
    if (!runs.length || runs.length > 100)
      throw Error('本实例没有可停止运行，或停止范围超过100条，请重新核对');
    if (this.active && !runs.some((r) => r.id === this.active!.id))
      throw Error('原运行正在收尾，请等待资源回收');
    return { record: structuredClone(record), instanceName: instance.name as string, runs };
  }
  private async stopHandoffRuns(ids: string[]) {
    const active = this.active;
    if (active && !ids.includes(active.id)) throw Error('活跃运行已变化，不停止其他流程');
    if (active) this.stop(active);
    for (const id of ids) {
      const run = this.store.get<Run>('run', id);
      if (run?.state === 'QUEUED') await this.cancelQueued(run);
    }
    if (active) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          active.done,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('原运行回收未确认，请核对原请求')), 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    this.assertAdmitting();
    for (const id of ids) {
      const run = this.store.get<Run>('run', id);
      if (
        !run ||
        !terminal.has(run.state) ||
        run.state === 'INTERRUPTED' ||
        this.active?.id === id ||
        this.scripts.hasRun(id) ||
        (this.pendingCapabilities.get(id) ?? 0) > 0
      )
        throw Error('原运行或能力回收未确认，不启动新入口');
    }
  }
  private assertAdmitting() {
    const blocked = this.executionBlock();
    if (blocked) throw new Error(blocked);
    if (this.suspended) throw new Error('系统正在休眠，恢复后请重新开始运行');
    if (this.stopping || this.store.fault) throw new Error(this.store.fault ?? '应用正在退出');
  }
  private assertAdmission(epoch: number) {
    if (epoch !== this.admissionEpoch)
      throw new Error('应用或运行准入已变化，本次请求已撤销，请重新核对');
    this.assertAdmitting();
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
    if (this.documents.recoveryError) this.blockExecution(this.documents.recoveryError);
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
    else if (method === 'credential') {
      if (
        this.store.get<FlowRecord & PreparedScripts>('snapshot', owner.runId)?.authorSdk ||
        this.store.get<FlowRecord>('snapshot', owner.runId)?.bindings.template
      )
        throw new Error('模板脚本不能直接读取凭据，请使用绑定的 AI 能力');
      result = await this.workerRequest(owner.runId, 'credential', args);
    } else if (method === 'template') {
      const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', owner.runId)!;
      result = snapshot.authorSdk
        ? this.authorSdk.call(snapshot, owner.runId, args, this.active!.abort.signal, () =>
            this.assertScriptOwner(owner),
          )
        : await this.templates.call(snapshot, owner.runId, args, this.active!.abort.signal, {
            browser: async (bindingId, command) => {
              const binding = this.store.get<BrowserBinding>('browser', bindingId);
              if (!binding) throw new Error('浏览器不存在');
              return this.sessions.use(binding, owner.runId, command, this.active!.abort.signal);
            },
            credential: async (id) => this.workerRequest(owner.runId, 'credential', { id }),
            artifact: async (name, content) =>
              this.workerRequest(owner.runId, 'artifact.create', { name, content }),
          });
    } else throw new Error('脚本能力不在白名单');
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
    templateSource?: TemplateSource,
  ) {
    templateSource = templateSource
      ? structuredClone(templateSourceSchema.parse(templateSource))
      : undefined;
    if (templateSource) this.templates.assertSource(flowId, templateSource);
    this.assertNoHandoff();
    const epoch = this.admissionEpoch;
    if (this.suspended) throw new Error('系统正在休眠，恢复后请重新开始运行');
    if (!this.recovering) this.assertAdmitting();
    else if (this.stopping || this.store.fault) throw new Error(this.store.fault ?? '应用正在退出');
    // Capture the requested content before waiting, while serializing admission
    // so a cheap second preflight cannot overtake the first manual request.
    const record = this.store.get<FlowRecord>(versionId ? 'version' : 'flow', versionId ?? flowId);
    if (!record) throw new Error('流程或版本不存在');
    const pending = this.admissions.then(async () => {
      await this.ready;
      return this.admit(
        epoch,
        record,
        flowId,
        versionId,
        scheduleId,
        triggerId,
        scheduleRevision,
        debug,
        templateSource,
      );
    });
    this.admissions = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  private async admit(
    epoch: number,
    record: FlowRecord,
    flowId: string,
    versionId?: string,
    scheduleId?: string,
    triggerId?: string,
    scheduleRevision?: string,
    debug = false,
    templateSource?: TemplateSource,
    handoffId?: string,
  ) {
    const check = () => {
      this.assertNoHandoff(handoffId);
      this.assertAdmission(epoch);
      if (templateSource) this.templates.assertSource(flowId, templateSource);
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
    if (
      scheduleId &&
      (prepared.authorSdk || prepared.templateData?.owner.kind === 'author-checkout')
    )
      throw Error('制作副本的配置与状态仅供明确试运行，请在正式模板实例中配置计划');
    check();
    this.credentialChecks.get(prepared)?.();
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
      if (handoffId) this.handoffs.created(handoffId, id);
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
    if (
      this.active ||
      this.handoffId ||
      this.stopping ||
      this.suspended ||
      this.store.fault ||
      this.executionBlock()
    )
      return;
    const queue = this.store.list<Run>('run').filter((r) => r.state === 'QUEUED');
    const run = queue.find((r) => r.id === this.handoffNextRun) ?? queue[0];
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
    if (this.handoffNextRun === run.id) this.handoffNextRun = undefined;
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
        await this.waitActive(active, this.runReview.checkExecution(run, s));
        const prepared = await this.waitActive(active, this.preflight(s, run.id)); // Never recompile a fixed bundle.
        this.checkActive(active);
        this.reruns.checkExecution(run, s);
        await this.waitActive(active, this.runReview.checkExecution(run, s));
        this.checkActive(active);
        outputs = await rpc.call(
          'execute',
          {
            ...s,
            parameters: resolveParameterSources(s.flow),
            debug: Boolean(run.debug),
            ...prepared,
            executable: this.executable,
          },
          24 * 3600000,
        );
        this.checkActive(active);
        this.authorSdk.complete(s, run.id, outputs, active.abort.signal, () =>
          this.checkActive(active),
        );
        await this.templates.complete(s, run.id, outputs);
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
      results.push(await this.mcpRuns.release(run.id));
      results.push(await this.documents.release(run.id));
      const desktopSnapshot = this.store.get<FlowRecord>('snapshot', run.id);
      if (desktopSnapshot?.desktopTarget?.binding)
        results.push(await this.desktopRuns.release(desktopSnapshot, run.id));
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
        this.templates.finish(run.id);
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
      active.abort.abort(new Error('运行正在收尾'));
      await this.mcpRuns.release(run.id);
      clearTimeout(active.cancelTimer);
      this.sessions.finishRun(run.id);
      rpc.close();
      this.secrets = [];
      if (this.active === active) this.active = undefined;
      this.aiNodes.release(run.id);
      this.templateData.release(run.id);
      await this.documents.release(run.id);
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
    if (method === 'mcp.cancel') return this.mcpRuns.cancel(id, args.nodeInstance);
    if (method === 'document.cancel')
      return this.active?.id === id ? this.documents.cancel(id, args.invocationId) : false;
    if (method === 'context.cancel') return this.templateData.cancel(id, args.nodeInstance);
    if (method === 'ai.cancel')
      return this.active?.id === id ? this.aiNodes.cancel(id, args.invocationId) : false;
    if (this.active?.id !== id) throw new Error('运行已停止');
    this.checkActive(this.active);
    const runSignal = this.active.abort.signal;
    const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', id)!;
    if (method === 'context.node') {
      const active = this.active,
        node = walk(snapshot.flow.steps).find((n) => n.id === args.nodeId);
      if (
        !node ||
        node.type !== 'context' ||
        typeof args.nodeInstance !== 'string' ||
        !active.nodeInstances?.has(args.nodeInstance) ||
        !(args.nodeInstance === node.id || args.nodeInstance.endsWith('/' + node.id))
      )
        throw Error('配置与状态节点不属于当前执行实例');
      const result = await this.templateData.perform(
        snapshot,
        id,
        node,
        args.nodeInstance,
        args.input,
        runSignal,
        () => this.checkActive(active),
      );
      this.typedResults.save(id, node.id, args.nodeInstance, 'context', result);
      return result;
    }
    if (method === 'skill.node') {
      const active = this.active;
      const node = walk(snapshot.flow.steps).find((n) => n.id === args.nodeId);
      if (!node || node.type !== 'skill') throw Error('Skill节点不在当前快照中');
      if (snapshot.bindings.template) {
        const { entry, pkg } = await this.templates.context(snapshot);
        const r = pkg.manifest.resources.find((r) => r.id === node.binding);
        if (
          !entry.capabilities.includes('skill') ||
          !entry.capabilities.includes('skill-v1') ||
          !entry.resources.includes(node.binding) ||
          (node.operation === 'propose'
            ? r?.kind !== 'directory' || r.access !== 'readwrite'
            : r?.kind !== 'skill' || r.access !== 'read')
        )
          throw Error('模板入口未声明Skill能力与准确资源');
      }
      if (node.operation === 'read') {
        const b = skillBinding(snapshot.bindings, node.binding);
        const current = await this.skills.read(b.path, b.skill);
        this.checkActive(active);
        const fixed = snapshot.skillSnapshots?.[node.id];
        if (!fixed || digest(fixed) !== digest(current)) throw Error('Skill固定快照不匹配');
        this.typedResults.save(id, node.id, args.nodeInstance, 'skill', fixed);
        return fixed;
      }
      const root = await this.fileDirectory(snapshot.bindings, node.binding);
      return this.skills.propose(snapshot, node, root, args.input, () => this.checkActive(active));
    }
    if (method === 'document.extract') {
      const active = this.active;
      const node = walk(snapshot.flow.steps).find((n) => n.id === args.nodeId);
      if (!node || node.type !== 'document') throw new Error('资料节点不在当前快照中');
      if (snapshot.bindings.template) {
        const { entry, pkg } = await this.templates.context(snapshot);
        const resource = pkg.manifest.resources.find((r) => r.id === node.binding);
        if (
          !entry.capabilities.includes('document') ||
          !entry.capabilities.includes('document-extract-v1') ||
          !entry.resources.includes(node.binding) ||
          resource?.kind !== 'directory' ||
          !['read', 'readwrite'].includes(resource.access)
        )
          throw new Error('模板入口未声明资料读取资源与能力');
      }
      const root = await this.fileDirectory(snapshot.bindings, node.binding);
      this.checkActive(active);
      const result = await this.documents.extract(
        id,
        args.invocationId,
        node,
        root,
        args.file,
        runSignal,
        () => this.checkActive(active),
      );
      this.checkActive(active);
      this.typedResults.save(id, node.id, args.nodeInstance, 'document', result);
      return result;
    }
    if (method === 'conversation.open') {
      const active = this.active;
      const node = walk(snapshot.flow.steps).find((n) => n.id === args.nodeId);
      if (!node || node.type !== 'conversation') throw new Error('会话节点不在当前快照中');
      if (snapshot.bindings.template) {
        const { entry, pkg } = await this.templates.context(snapshot);
        const resource = pkg.manifest.resources.find((r) => r.id === node.binding);
        if (
          !entry.capabilities.includes('conversation-v1') ||
          !entry.capabilities.includes('conversation') ||
          !entry.capabilities.includes('ai') ||
          !entry.resources.includes(node.binding) ||
          resource?.kind !== 'ai' ||
          resource.access !== 'use'
        )
          throw new Error('模板入口未声明会话能力与AI资源');
      }
      const result = this.conversations.open(snapshot, node, args.input, args.key, () =>
        this.checkActive(active),
      );
      this.checkActive(active);
      this.typedResults.save(id, node.id, args.nodeInstance, 'conversation', result);
      return result;
    }
    if (method === 'ai.call') {
      const active = this.active;
      const node = walk(snapshot.flow.steps).find((n) => n.id === args.nodeId);
      if (!node || node.type !== 'ai') throw new Error('AI 节点不在运行快照中');
      if (snapshot.bindings.template) {
        const { entry, pkg } = await this.templates.context(snapshot);
        const resource = pkg.manifest.resources.find((r) => r.id === node.binding);
        if (
          !entry.capabilities.includes('ai-node-v1') ||
          (node.version === 2 && !entry.capabilities.includes('ai-outcome-v1')) ||
          !entry.capabilities.includes('ai') ||
          !entry.resources.includes(node.binding) ||
          resource?.kind !== 'ai' ||
          resource.access !== 'use'
        )
          throw new Error('模板入口未声明当前 AI 能力与资源');
      }
      return this.aiNodes.perform(snapshot, id, args, runSignal, () => this.checkActive(active));
    }
    if (method === 'mcp.call') {
      const active = this.active;
      const run = this.store.get<Run>('run', id);
      if (!run) throw new Error('运行不存在');
      return this.mcpRuns.perform(run, snapshot, args, runSignal, () => this.checkActive(active!));
    }
    if (method === 'desktop.replace') {
      const active = this.active;
      const run = this.store.get<Run>('run', id);
      if (!run) throw new Error('运行不存在');
      return this.desktopRuns.perform(run, snapshot, args.nodeId, args.nodeInstance, () =>
        this.checkActive(active!),
      );
    }
    if (method === 'output-target.boundary') {
      if (!snapshot.outputTarget) throw new Error('运行没有所选输出');
      await this.outputs.record(snapshot);
      this.checkActive(this.active!);
      return true;
    }
    if (method === 'web-target.boundary') {
      if (!snapshot.webTarget) throw new Error('运行没有所选网页');
      await this.webTargets.record(snapshot, this.sessions.selectedPage(id));
      this.checkActive(this.active!);
      return true;
    }
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
    if (method === 'node.authorize') {
      if (!snapshot.bindings.template) return true;
      const node = walk(snapshot.flow.steps).find((n) => n.id === args.id);
      if (!node) throw new Error('节点不属于当前快照');
      const { entry, pkg } = await this.templates.context(snapshot);
      if (!entry.capabilities.includes(node.type)) throw new Error('入口未声明节点能力');
      if (node.type === 'file' || node.type === 'excel') {
        const binding = args.binding;
        const resource = pkg.manifest.resources.find((r) => r.id === binding);
        if (!entry.resources.includes(binding) || !resource || resource.kind !== 'directory')
          throw new Error('节点资源未由入口声明');
        const write = node.operation !== 'read';
        if (!(write ? ['write', 'readwrite'] : ['read', 'readwrite']).includes(resource.access))
          throw new Error('文件操作超出资源声明');
        if (write) await this.templates.canWrite(snapshot, id, runSignal);
      }
      if (node.type === 'http' && node.method !== 'GET')
        await this.templates.canWrite(snapshot, id, runSignal);
      return true;
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
      if (args.type === 'node-start') {
        if (
          typeof args.nodeInstance !== 'string' ||
          !args.nodeInstance ||
          args.nodeInstance.length > 2048
        )
          throw Error('节点实例身份无效');
        this.active.nodeInstances ??= new Set();
        this.active.nodeInstances.add(args.nodeInstance);
      } else if (args.type === 'node-end') this.active.nodeInstances?.delete(args.nodeInstance);
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
      const active = this.active;
      const inspection = args.version === 4;
      if (inspection) {
        const { nodeInstance, ...nodeInput } = args;
        assertBrowserInspectionNode(nodeInput, true);
        const source = walk(snapshot.flow.steps).find((n) => n.id === args.id);
        if (
          !source ||
          source.type !== 'browser' ||
          source.version !== 4 ||
          source.operation !== args.operation ||
          !snapshot.flow.requiredCapabilities.includes(browserInspectionCapability) ||
          typeof nodeInstance !== 'string' ||
          !active?.nodeInstances?.has(nodeInstance) ||
          nodeInstance.split('/').at(-1) !== source.id
        )
          throw Error('网页只读节点不在当前固定运行中');
        if (snapshot.bindings.template) {
          const { entry } = await this.templates.context(snapshot);
          if (!entry.capabilities.includes(browserInspectionCapability))
            throw Error('模板入口未声明网页只读能力');
          this.checkActive(active);
        }
      }
      if (['click', 'fill', 'select', 'check', 'press', 'upload'].includes(args.operation))
        await this.templates.canWrite(snapshot, id, runSignal);
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
      const result = await this.sessions.use(binding, id, command, runSignal, snapshot.webTarget);
      this.checkActive(active);
      runSignal.throwIfAborted();
      if (inspection) {
        assertBrowserInspectionResult(args.operation, result);
        this.typedResults.save(id, args.id, args.nodeInstance, 'browser', result);
        return result;
      }
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
      this.localCredentials.assertReadable(args.id);
      const secret = await this.system('credentials.get', { id: args.id });
      this.secrets.push(secret);
      return secret;
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
  private async cancelQueued(run: Run) {
    try {
      this.store.state(run.id, 'CANCELLED');
    } finally {
      const snapshot = this.store.get<FlowRecord>('snapshot', run.id);
      if (snapshot?.desktopTarget?.binding) {
        const cleanup = await this.desktopRuns.release(snapshot, run.id);
        if (!cleanup.confirmed) {
          this.store.state(run.id, 'INTERRUPTED', { error: cleanup.error });
          this.store.attention(
            'limitation',
            '应用助手退出待核对',
            { runId: run.id },
            'desktop-cleanup:' + run.id,
          );
        }
      }
    }
  }
  async control(id: string, action: 'pause' | 'resume' | 'step' | 'cancel') {
    const run = this.store.get<Run>('run', id);
    if (!run) throw new Error('运行不存在');
    if (terminal.has(run.state)) return false;
    if (action === 'cancel' && run.state === 'QUEUED') {
      await this.cancelQueued(run);
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
    if (this.suspended) return;
    const epoch = this.admissionEpoch;
    await this.ready;
    if (
      epoch !== this.admissionEpoch ||
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
          if (
            epoch !== this.admissionEpoch ||
            this.executionBlock() ||
            this.stopping ||
            this.suspended ||
            this.store.fault
          )
            break;
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
                reason: this.redactError(e),
                time,
              });
            }
        }
    } finally {
      this.ticking = false;
    }
  }
  private suspend(): Promise<boolean> {
    if (this.suspended) return this.suspension ?? Promise.resolve(true);
    this.suspended = true;
    this.admissionEpoch++;
    // Capture the actual owner before any historical read or diagnostic write.
    this.suspension = this.finishSuspend(this.active);
    return this.suspension;
  }
  private async finishSuspend(active: Active | undefined): Promise<boolean> {
    const errors: unknown[] = [];
    const aiCleanup = this.aiSettings.cancelAll().catch((error) => {
      errors.push(error);
    });
    const toolCleanup = this.toolConnections.cancelAll().catch((error) => {
      errors.push(error);
    });
    try {
      this.desktopPlanning.invalidate();
      this.desktopRuns.cancelAll();
      this.planning.cancelAll();
      await this.conversations.cancelAll();
    } catch (error) {
      errors.push(error);
    }
    const ids = new Set<string>(active ? [active.id] : []);
    if (active) {
      try {
        this.stop(active);
      } catch (error) {
        // stop revokes resources before its CANCELLING write; keep that error.
        errors.push(error);
      }
    }
    let runs: Run[] = [];
    try {
      runs = this.store.list<Run>('run').filter((run) => !terminal.has(run.state));
      for (const run of runs) ids.add(run.id);
    } catch (error) {
      errors.push(error);
    }
    for (const id of ids) {
      try {
        this.store.event(id, 'system-suspend', '', {
          reason: '休眠停止运行；外部结果需核对，不自动重放',
        });
      } catch (error) {
        errors.push(error);
      }
    }
    for (const run of runs) {
      if (run.state !== 'QUEUED') continue;
      try {
        await this.cancelQueued(run);
      } catch (error) {
        errors.push(error);
      }
    }
    // Use the existing cooperative cancellation, timeout and cleanup result.
    // A rejected diagnostic must not return before the actual owner finishes.
    if (active) await active.done;
    await toolCleanup;
    await aiCleanup;
    if (this.store.fault && !errors.length) errors.push(new Error(this.store.fault));
    if (ids.size) {
      try {
        this.store.attention(
          'limitation',
          this.executionBlock()
            ? '休眠后资源回收未确认，请核对运行结果'
            : '休眠已停止任务，请核对结果后重新运行',
          { runIds: [...ids] },
          'suspend:' + [...ids].join(','),
        );
        void this.system('notification', {}).catch(() => {});
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, '休眠收尾遇到本地记录错误，请核对最后保存的状态与运行结果');
    return true;
  }
  async request(method: string, args: any = {}): Promise<any> {
    if (method.startsWith('template.handoff.')) {
      await this.ready;
      const rule = handoffMethods[method as keyof typeof handoffMethods];
      if (!rule) throw Error('入口切换方法未授权');
      const v = rule.parse(args) as any;
      if (method === 'template.handoff.get') return this.handoffs.get(v.requestId);
      if (method === 'template.handoff.list') return this.handoffs.list(v.instanceId);
      if (method === 'template.handoff.preview') {
        this.assertNoHandoff();
        return this.handoffs.preview(v);
      }
      return this.handoffs.confirm(v);
    }
    if (method.startsWith('context.')) {
      await this.ready;
      const rule = dataMethods[method as keyof typeof dataMethods];
      if (!rule) throw Error('配置与状态方法未授权');
      const v = rule.parse(args) as any;
      if (method === 'context.debug.get') return this.templateData.debugGet(v.flowId);
      if (method === 'context.debug.save') return this.templateData.debugSave(v.edit);
      if (method === 'context.operations') return this.templateData.operations(v.runId);
      return this.templateData.inspect(v.runId, v.operationId);
    }
    if (method.startsWith('author.')) {
      await this.ready;
      if (method === 'author.export.begin') {
        const v = authorMethods['author.export'].parse(args);
        return this.author.begin(v);
      }
      if (method === 'author.export.write') {
        const { path, ...base } = args;
        const v = authorMethods['author.export.inspect'].parse(base);
        if (typeof path !== 'string' || path.length > 4096) throw Error('导出路径由Main选择');
        return this.author.write(v.id, v.requestId, path);
      }
      const rule = authorMethods[method as keyof typeof authorMethods];
      if (!rule) throw Error('模板制作方法未授权');
      const v = rule.parse(args) as any;
      switch (method) {
        case 'author.sdk.result':
          return this.authorSdk.read(v.runId);
        case 'author.schema.check':
          return this.author.schema(v.schema, v.form);
        case 'author.list':
          return this.author.list();
        case 'author.create':
          return this.author.create(v.requestId);
        case 'author.fork':
          return this.author.create(v.requestId, v.key);
        case 'author.detail':
          return this.author.detail(v.id);
        case 'author.save':
          return this.author.save(v.id, v.revision, v.definition);
        case 'author.checkout':
          return this.author.checkout(v.id, v.revision, v.entryId, v.requestId);
        case 'author.checkout.origin':
          return this.author.origin(v.flowId);
        case 'author.flow.source':
          return this.author.source(v.flowId);
        case 'author.adopt.preview':
          return this.author.adoption(v.checkoutId, v.revision, v.detach);
        case 'author.adopt.confirm':
          return this.author.adopt(v.id, v.revision, v.token, v.requestId);
        case 'author.preview':
          return this.author.preview(v.id, v.revision);
        case 'author.file':
          return this.author.file(v.id, v.token, v.path);
        case 'author.export.inspect':
          return this.author.inspect(v.id, v.requestId);
        case 'author.export.cancel':
          return this.author.cancel(v.id, v.requestId);
        default:
          throw Error('模板导出位置须由Main选择');
      }
    }
    if (method === 'run.typedResult') {
      await this.ready;
      const v = methods['run.typedResult'].parse(args);
      return this.typedResults.read(v.runId, v.id);
    }
    if (method.startsWith('skill.')) {
      await this.ready;
      const rule =
        trialMethods[method as keyof typeof trialMethods] ??
        skillMethods[method as keyof typeof skillMethods];
      if (!rule) throw Error('Skill IPC方法未授权');
      const v = rule.parse(args) as any;
      if (method === 'skill.trial.preview') return this.skills.trialPreview(v.id, v.revision);
      if (method === 'skill.trial.start') {
        const old = this.conversations.trialResult(v);
        if (old) return old;
        const fixed = await this.skills.trialInput(v.source);
        return this.conversations.openSkillTrial(v, fixed);
      }
      if (method === 'skill.list') return this.skills.list();
      if (method === 'skill.inspectBinding') {
        const r = await this.skills.read(v.path, v.ref);
        return { ref: r.ref, title: r.title, confirmedAt: r.confirmedAt };
      }
      if (method === 'skill.detail') return this.skills.detail(v.id);
      if (method === 'skill.base') return this.skills.base(v.id);
      if (method === 'skill.save') return this.skills.save(v.id, v.revision, v.draft);
      if (method === 'skill.preview') return this.skills.preview(v.id, v.revision);
      if (method === 'skill.confirm') return this.skills.confirm(v);
      if (method === 'skill.cancelUnstarted') return this.skills.cancelUnstarted(v.id, v.requestId);
      if (method === 'skill.inspect') return this.skills.inspect(v.id, v.requestId);
      if (method === 'skill.rebase') return this.skills.rebase(v);
      if (method === 'skill.fork') return this.skills.fork(v.id);
      if (method === 'skill.relocate') return this.skills.relocate(v.id, v.path);
    }
    if (method.startsWith('conversation.')) {
      await this.ready;
      const rule =
        trialMethods[method as keyof typeof trialMethods] ??
        conversationMethods[method as keyof typeof conversationMethods];
      if (!rule) throw new Error('会话IPC方法未授权');
      const value = rule.parse(args) as any;
      if (method === 'conversation.output') return this.conversations.output(value.id);
      if (method === 'conversation.trialStatus') return this.conversations.trialStatus(value.id);
      if (method === 'conversation.detail') return this.conversations.detail(value.id);
      if (method === 'conversation.draft')
        return this.conversations.draft(value.id, value.revision, value.text);
      if (method === 'conversation.send') {
        return this.conversations.sendChecked(
          value.id,
          value.revision,
          value.requestId,
          value.text,
        );
      }
      if (method === 'conversation.retry') {
        return this.conversations.sendChecked(value.id, value.revision, value.requestId);
      }
      if (method === 'conversation.cancel')
        return this.conversations.cancel(value.id, value.requestId);
      if (method === 'conversation.confirm')
        return this.conversations.confirm(value.id, value.revision);
    }
    if (method.startsWith('credential.local.')) {
      await this.ready;
      return this.localCredentials.request(method, args);
    }
    if (method.startsWith('ai.configuration.')) {
      await this.ready;
      return this.aiSettings.request(method, args);
    }
    if (method.startsWith('tool.connection.')) {
      await this.ready;
      return this.toolConnections.request(method, args);
    }
    if (method.startsWith('learning.')) {
      await this.ready;
      return this.learning.request(method, args);
    }
    if (method === 'system.desktop.invalidate')
      return this.desktopPlanning.invalidate(args.observationId);
    if (method.startsWith('desktop.plan.')) {
      await this.ready;
      return this.desktopPlanning.request(method, args);
    }
    if (method.startsWith('desktop.run.')) {
      await this.ready;
      return this.desktopRuns.request(method, args);
    }
    if (method.startsWith('task.')) {
      await this.ready;
      if (
        ['task.generate', 'task.repair.generate'].includes(method) &&
        this.desktopPlanning.hasTask(args.id)
      )
        throw new Error('应用选区仍在生成，请先取消或等待完成');
      if (['task.save', 'task.adopt', 'task.undo', 'task.cancel'].includes(method))
        this.desktopPlanning.cancelTask(args.id);
      return this.planning.request(method, args);
    }
    switch (method) {
      case 'system.suspend':
        return this.suspend();
      case 'system.resume': {
        if (!this.suspended) return true;
        const epoch = this.admissionEpoch;
        await this.suspension?.catch(() => {});
        if (epoch !== this.admissionEpoch) return false;
        this.skipMissed('system-resume');
        this.lastTick = Date.now();
        this.suspended = false;
        return true;
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
          args.templateSource,
        );
      case 'flow.create': {
        return this.saveFlow(
          { ...structuredClone(example), id: uid() },
          { files: {}, credentials: [] },
        );
      }
      case 'run.control':
        return this.control(args.id, args.action);
      case 'run.list':
        return listRuns(this.store, args, () => ({
          execution: this.observeExecution(),
          fault: this.store.fault,
        }));
      case 'flow.run.preview':
        await this.ready;
        return this.runReview.preview(args);
      case 'run.rerun.preview':
        await this.ready;
        return this.reruns.preview(args);
      case 'flow.run.confirm':
      case 'run.rerun.confirm': {
        const epoch = this.admissionEpoch;
        const suspended = this.suspended;
        const pending = this.admissions.then(async () => {
          await this.ready;
          const check = () => {
            if (suspended) throw new Error('系统正在休眠，恢复后请重新开始运行');
            this.assertAdmission(epoch);
          };
          return method === 'flow.run.confirm'
            ? this.runReview.confirmOutcome(args, check)
            : this.reruns.confirm(args, check);
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
        const rerun = this.reruns.details(id);
        const artifactCleanup = this.artifactCleanup.status(id);
        const run = this.store.get<Run>('run', id);
        return {
          run,
          desktopReceipts: redact(this.desktopRuns.receipts(id), this.secrets),
          mcpReceipts: this.mcpRuns
            .receipts(id)
            .map((receipt) => redactMcpReceipt(receipt, this.secrets)),
          targetContext: runTargetContext(run, snapshot, this.secrets),
          rerun: {
            ...rerun,
            ...(rerun.reason ? { reason: redact(rerun.reason, this.secrets) } : {}),
          },
          artifactCleanup: artifactCleanup
            ? {
                ...artifactCleanup,
                ...(artifactCleanup.error
                  ? { error: redact(artifactCleanup.error, this.secrets) }
                  : {}),
              }
            : artifactCleanup,
          events: this.store.events(id),
          artifacts,
          output: redact(this.store.get('output', id)),
          typedResults: this.typedResults
            .list(id)
            .filter((r) => run?.state === 'SUCCEEDED' || r.type === 'context'),
          snapshot: snapshot?.flow,
          scriptBundles: snapshot?.scriptBundles ?? [],
          authorSdk: snapshot?.authorSdk,
          fault: this.store.fault ? redact(this.store.fault, this.secrets) : undefined,
          execution: this.observeExecution(),
        };
      }
      case 'artifact.preview': {
        const attemptId = this.learning.status().attemptId;
        const item = this.store.get<any>('artifact', args.id);
        if (!item) throw new Error('产物不存在');
        const result = await this.artifactFiles.preview(item);
        const base = { artifactId: args.id, name: item.name, size: item.size };
        const latest = this.store.get<any>('artifact', args.id);
        if (!latest || digest(latest) !== digest(item))
          return { ...base, status: 'unavailable', reason: '产物记录已经变化，请重新读取' };
        if ('reason' in result) return { ...base, status: 'unavailable', reason: result.reason };
        this.learning.result(attemptId, { runId: item.runId, artifactId: args.id }, result.text);
        return {
          ...base,
          status: 'text',
          ...redactArtifactText(result.text, [...this.secrets, ...(args.redactionSecrets ?? [])]),
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
      case 'browser.embedded.pick.confirm':
      case 'browser.embedded.pick.focus':
      case 'browser.embedded.observation':
      case 'browser.embedded.pan':
      case 'browser.embedded.pick.validate': {
        if (this.executionBlock()) throw new Error(this.executionBlock());
        if (this.active) {
          const run = this.store.get<Run>('run', this.active.id);
          if (
            !run ||
            !['PAUSED', 'WAITING_INPUT'].includes(run.state) ||
            this.active.controlPending
          )
            throw new Error(
              method === 'browser.embedded.observation' || method === 'browser.embedded.pan'
                ? '请先暂停当前任务，再调整网页查看'
                : '请先暂停当前任务，再选取或验证元素',
            );
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
      case 'schedule.inspect': {
        await this.ready;
        return inspectSchedule(this.store, args, (reason) => redact(reason, this.secrets));
      }
      case 'schedule.save': {
        args = scheduleCreateSchema.parse(args);
        await this.ready;
        this.assertAdmitting();
        const r = this.store.get<FlowRecord>('flow', args.flowId);
        if (!r) throw new Error('流程不存在');
        if (args.flowUpdatedAt && r.updatedAt !== args.flowUpdatedAt)
          throw new Error('已保存的流程已改变，请重新选择并核对');
        const sourceDigest = args.flowUpdatedAt ? digest(r) : undefined;
        if (args.templateSource) this.templates.assertSource(r.id, args.templateSource);
        await this.templates.preflight(r, true);
        const prepared = await this.preflight(r);
        if (prepared.authorSdk) throw Error('作者调试副本不可创建本机计划，请在正式实例中配置');
        this.assertAdmitting();
        new Intl.DateTimeFormat('en', { timeZone: args.timezone });
        if (args.templateSource) this.templates.assertSource(r.id, args.templateSource);
        const currentSource = this.store.get('flow', r.id);
        if (sourceDigest && (!currentSource || digest(currentSource) !== sourceDigest))
          throw new Error('已保存的流程已改变，请重新选择并核对');
        return this.store.tx(() => {
          const s = {
            id: uid(),
            flowId: r.id,
            versionId: this.version(r, prepared),
            intervalMinutes: args.intervalMinutes,
            timezone: args.timezone,
            enabled: false,
            nextAt: Date.now() + args.intervalMinutes * 60000,
            revision: uid(),
          };
          this.store.put('schedule', s.id, s);
          return s;
        });
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
          await this.templates.preflight(record, true);
          prepared = await this.preflight(record);
          if (prepared.authorSdk) throw Error('作者调试副本不可创建本机计划，请在正式实例中配置');
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
      case 'template.inspect':
        return this.templates.library.inspect(args.path);
      case 'template.cancelImport':
        return this.templates.library.cancel(args.token);
      case 'template.install':
        return this.templates.install(args.token);
      case 'template.remove':
        return this.templates.remove(args.key);
      case 'template.export':
        return this.templates.library.export(args.key, args.path);
      case 'template.create':
        return this.templates.create(args.key, args.copyFrom);
      case 'template.detail':
        return this.templates.detail(args.id);
      case 'template.save':
        return this.templates.save(args);
      case 'template.answer':
        return this.templates.answer(args.id, args.value);
      case 'flow.export': {
        const { path, identity, ...payload } = args;
        const request = flowExportSchema.parse(payload);
        if (typeof path !== 'string') throw new Error('导出路径由 Main 选择');
        const record = this.store.get<FlowRecord>('flow', (request.flow as Flow).id);
        const ref = record?.bindings.template;
        const source = ref ? await this.templates.library.load(ref.packageKey) : undefined;
        const pkg = await exportDefinition(
          request.flow as Flow,
          request.configuration,
          source,
          ref?.entryId,
          identity,
        );
        await writeArchive(pkg, path);
        return {
          id: pkg.manifest.id,
          version: pkg.manifest.version,
          digest: pkg.manifest.contentDigest,
        };
      }
      case 'flow.import':
        throw new Error('旧 JSON 模板不再支持，请导入标准 ZIP 模板');
      case 'shutdown':
        await this.shutdown();
        return true;
      default:
        throw new Error('宿主方法未授权：' + method);
    }
  }
  async shutdown() {
    this.stopping = true;
    const toolErrors: unknown[] = [];
    const aiCleanup = this.aiSettings.cancelAll().catch((error) => {
      toolErrors.push(error);
    });
    const toolCleanup = this.toolConnections.cancelAll().catch((error) => {
      toolErrors.push(error);
    });
    let planningError: unknown;
    try {
      this.desktopPlanning.invalidate();
      this.desktopRuns.cancelAll();
      this.planning.cancelAll();
      await this.conversations.cancelAll();
      await this.skills.stop();
      await this.author.stop();
    } catch (error) {
      planningError = error;
    }
    await this.templates.library.dispose();
    clearInterval(this.timer);
    const errors: unknown[] = [];
    if (planningError) errors.push(planningError);
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
            await this.cancelQueued(r);
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
    await toolCleanup;
    await aiCleanup;
    errors.push(...toolErrors);
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
