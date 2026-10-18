import { aiBinding } from '../shared/ai-node';
import { resolveParameterSources } from '../shared/parameter-sources';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import type { Store } from './store';
import { assertRerunBindings, executionVersion } from './run-rerun';
import { validateFlow, walk } from '../core/validate';
import { staticUploadFields, uploadText } from '../shared/upload-source';
import { digest, now, redactedErrorText, uid } from '../shared/utils';
import type { BrowserBinding, FlowRecord, PreparedScripts, Run } from '../shared/types';
import type { PlanningTask } from '../shared/planning';
import type { RepairSelection } from '../shared/task-repair';
import {
  runReviewConfirmSchema,
  runReviewPreviewSchema,
  type EmbeddedReview,
  type ReviewResource,
  type RunReviewConfirmation,
  type RunReviewInput,
  type RunReviewPreview,
  type RunReviewOutcome,
} from '../shared/run-review';
import { reviewEffects } from './run-review-effects';
import { reviewToolCalls } from './run-review-tools';
import type { TaskMcpState } from '../shared/task-mcp-targets';
import type { DesktopRuns } from './desktop-runs';
import type { DesktopBinding } from '../shared/desktop-run';
import { planningFlowHash } from './planning-scope';

export type ReviewTemplate = {
  resources: {
    id: string;
    name: string;
    kind: 'file' | 'directory' | 'browser' | 'ai' | 'skill' | 'conversation-source';
    access: 'read' | 'write' | 'readwrite' | 'use';
    required: boolean;
  }[];
  actions: { id: string; name: string; description: string }[];
};
type PathRequirement = {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'directory';
  read: boolean;
  write: boolean;
};
type PathIdentity = PathRequirement & {
  real: string;
  dev: number;
  ino: number;
  size?: number;
  mtimeMs?: number;
};
type Authorization = {
  tools?: { selectionId: string; connectionRevision: number; capabilityDigest: string }[];
  desktop?: DesktopBinding;
  target?: RepairSelection;
  paths: PathIdentity[];
  browsers: BrowserBinding[];
  embedded?: EmbeddedReview;
  template?: ReviewTemplate;
};
type Snapshot = FlowRecord & Partial<PreparedScripts> & { runReviewAuthorization?: Authorization };
type RequestRecord = { requestId: string; fingerprint: string; runId: string };
type Dependencies = {
  desktop?: DesktopRuns;
  tools?: (record: FlowRecord) => TaskMcpState[];
  learnedTrial?: (run: Run) => void;
  busy?: (runId: string) => boolean;
  target?: (selection: RepairSelection) => Promise<RepairSelection>;
  assertAdmitting: () => void;
  epoch: () => number;
  preflight: (record: Snapshot) => Promise<PreparedScripts>;
  version: (record: FlowRecord, prepared: PreparedScripts) => string;
  dispatch: () => void;
  embedded: () => Promise<EmbeddedReview>;
  template: (record: FlowRecord) => Promise<ReviewTemplate>;
  error?: (error: unknown) => string;
};
const limitations = [
  '试运行执行真实操作，可能产生文件覆盖、网页提交或其他副作用。',
  '页面身份检查不核对账号、DOM 内容或选区；外部浏览器的页面由专用会话和步骤决定。',
  '目录只检查系统访问权限，未试写业务文件；剩余空间、动态文件和任意脚本影响尚未验证。',
  '条件两路均列入影响，循环次数在执行时确定；原有逐动作授权继续生效。',
];

export class RunReview {
  private readonly session = uid();
  constructor(
    private store: Store,
    private deps: Dependencies,
  ) {}

  private capture(args: RunReviewInput) {
    this.deps.assertAdmitting();
    const record = this.store.get<FlowRecord>('flow', args.id);
    if (!record || record.flow.id !== args.id) throw new Error('已保存流程不存在或标识不一致');
    validateFlow(record.flow);
    if (
      record.flow.steps.some((step) => step.type === 'desktop') &&
      (!args.task || args.task.id !== record.desktopTarget?.taskId)
    )
      throw new Error('请从保存此应用方案的原任务进入试运行');
    if (
      walk(record.flow.steps).some((node) => node.type === 'mcp') &&
      (!args.task ||
        !record.toolTargets?.length ||
        record.toolTargets.some((target) => target.taskId !== args.task!.id))
    )
      throw new Error('请从保存此工具方案的原任务进入试运行');
    let task: (PlanningTask & { proposal?: unknown }) | undefined;
    if (args.task) {
      task = this.store.get('ai-task', args.task.id);
      if (!task || task.flowId !== args.id || task.revision !== args.task.revision)
        throw new Error('任务或关联流程已改变，请重新检查');
      if (task.status === 'generating' || task.proposal)
        throw new Error('任务仍在生成或有未处理提案，请先核对并采纳或拒绝');
    }
    let rerun: Run | undefined;
    if (args.rerun) {
      rerun = this.store.get<Run>('run', args.rerun.runId);
      if (
        !task ||
        !rerun ||
        rerun.flowId !== record.id ||
        !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(rerun.state)
      )
        throw new Error('原运行必须属于此任务且已经结束');
      if (this.deps.busy?.(rerun.id)) throw new Error('原运行仍在收尾，请稍后重新检查');
      if (rerun.task && rerun.task.id !== task.id) throw new Error('原运行不属于所选任务');
      const snapshot = this.store.get<FlowRecord>('snapshot', rerun.id);
      if (!snapshot || snapshot.id !== record.id || snapshot.flow.id !== record.id)
        throw new Error('原运行快照不存在或来源不一致');
    }
    if (task?.appliedRepair && task.appliedRepair.flowHash !== planningFlowHash(record))
      throw new Error('修复后的草稿或绑定已改变，请回到任务重新核对');
    return {
      record,
      target: task?.appliedRepair?.selection,
      rerun,
      signature: digest({
        rerun,
        sourceSnapshot: rerun ? this.store.get('snapshot', rerun.id) : undefined,
        sourceEvents: rerun ? this.store.events(rerun.id) : undefined,
        record,
        task,
        epoch: this.deps.epoch(),
        session: this.session,
        debug: !!args.debug,
      }),
    };
  }

  private async environment(record: FlowRecord, target?: RepairSelection, runId?: string) {
    const hasDesktop = walk(record.flow.steps).some((node) => node.type === 'desktop');
    if (hasDesktop && !this.deps.desktop) throw new Error('应用执行服务不可用');
    const desktop = hasDesktop ? await this.deps.desktop!.verify(record, runId) : undefined;
    const paths = new Map<string, PathRequirement>();
    const resources: ReviewResource[] = (record.toolTargets ?? []).map((target) => ({
      id: 'mcp:' + target.selectionId,
      name: target.displayName,
      kind: 'action',
      access: '本次工具调用',
      detail: target.source + '；实际发送参数和外部影响见下方工具明细。',
    }));
    if (desktop)
      resources.push({
        id: 'desktop:' + desktop.bindingId,
        name: '文本编辑 · ' + desktop.windowTitle,
        kind: 'action',
        access: '单次替换并回读',
        detail: '仅本次核对的原选区；运行期间请勿切换文档或更改选区。',
      });
    const browserIds = new Set<string>();
    const directory = (name: string, read: boolean, write: boolean) => {
      if (!Object.hasOwn(record.bindings.files, name) || !record.bindings.files[name])
        throw new Error('目录未绑定：' + name);
      const id = 'directory:' + name,
        previous = paths.get(id);
      paths.set(id, {
        id,
        name,
        path: record.bindings.files[name],
        kind: 'directory',
        read: read || !!previous?.read,
        write: write || !!previous?.write,
      });
    };
    const steps = walk(record.flow.steps);
    for (const node of steps) {
      if (node.type === 'document') directory(node.binding, true, false);
      if (node.type === 'source' || node.type === 'source-reduce') {
        const ref = record.bindings.resources?.[node.binding]?.source;
        if (!ref) throw Error('完整来源尚未选择');
        if (!resources.some((r) => r.id === 'source:' + node.binding))
          resources.push({
            id: 'source:' + node.binding,
            name: node.binding,
            kind: 'conversation-source',
            access: 'read',
            detail: '固定完整来源 · 版本' + ref.sha256.slice(0, 8) + '；不调用模型',
          });
      }
      if (node.type === 'skill') {
        if (node.operation !== 'read') directory(node.binding, true, true);
        else {
          const b = record.bindings.resources?.[node.binding];
          if (!b?.skill || !b.path) throw Error('Skill确认版本尚未选择');
          resources.push({
            id: 'skill:' + node.binding,
            name: node.binding,
            kind: 'skill',
            access: 'read',
            detail: b.skill.key + ' / ' + b.skill.versionId + ' / ' + b.skill.sha256,
          });
        }
      }
      if (node.type === 'file' || node.type === 'excel')
        directory(
          node.binding,
          node.operation !== 'map' &&
            node.operation !== 'create' &&
            (node.operation !== 'write' || node.type === 'excel'),
          node.operation !== 'read',
        );
      if (node.type === 'browser') {
        if (!record.bindings.browserId) throw new Error('请先选择本机浏览器');
        browserIds.add(record.bindings.browserId);
        if (node.operation === 'upload') {
          const fields = staticUploadFields(node.value, resolveParameterSources(record.flow));
          if (fields?.binding.known)
            directory(uploadText(fields.binding.value, 'binding'), true, false);
          else for (const name of Object.keys(record.bindings.files)) directory(name, true, false);
        }
      }
      if (node.type === 'ai' || node.type === 'conversation' || node.type === 'source-reduce') {
        const key = node.type === 'source-reduce' ? node.aiBinding : node.binding;
        const binding = aiBinding(record.bindings, key);
        if (!resources.some((r) => r.id === 'ai:' + key))
          resources.push({
            id: 'ai:' + key,
            name: key,
            kind: 'ai',
            access: 'use',
            detail: binding.provider + ' / ' + binding.model + '；使用用户自己的Key并产生token消耗',
          });
      }
      if (node.type === 'script') {
        for (const name of Object.keys(record.bindings.files)) directory(name, true, true);
        if (record.bindings.browserId) browserIds.add(record.bindings.browserId);
      }
    }
    const template = record.bindings.template ? await this.deps.template(record) : undefined;
    for (const declaration of template?.resources ?? []) {
      const binding = record.bindings.resources?.[declaration.id];
      if (!binding) {
        if (declaration.required) throw new Error('入口缺少资源绑定：' + declaration.name);
        continue;
      }
      if (declaration.kind === 'file' || declaration.kind === 'directory') {
        if (!binding.path) throw new Error('文件路径未绑定：' + declaration.name);
        const id = 'template:' + declaration.id;
        paths.set(id, {
          id,
          name: declaration.name,
          path: binding.path,
          kind: declaration.kind,
          read: declaration.access !== 'write',
          write: ['write', 'readwrite'].includes(declaration.access),
        });
      } else if (declaration.kind === 'conversation-source') {
        if (!binding.source) throw Error('完整来源尚未选择');
        resources.push({
          id: 'template:' + declaration.id,
          name: declaration.name,
          kind: 'conversation-source',
          access: 'read',
          detail: '固定完整来源 · 版本' + binding.source.sha256.slice(0, 8),
        });
      } else if (declaration.kind === 'skill') {
        if (!binding.skill || !binding.path) throw Error('Skill确认版本尚未选择');
        resources.push({
          id: 'template:' + declaration.id,
          name: declaration.name,
          kind: 'skill',
          access: 'read',
          detail: binding.skill.key + ' / ' + binding.skill.versionId,
        });
      } else if (declaration.kind === 'browser') {
        if (!binding.browserId) throw new Error('浏览器未绑定：' + declaration.name);
        browserIds.add(binding.browserId);
      } else {
        if (!binding.provider || !binding.model)
          throw new Error('AI 供应商或模型未配置：' + declaration.name);
        resources.push({
          id: 'template:' + declaration.id,
          name: declaration.name,
          kind: 'ai',
          access: 'use',
          detail: binding.provider + ' / ' + binding.model,
        });
      }
    }
    for (const action of template?.actions ?? []) {
      const mode = record.bindings.grants?.[action.id] ?? 'deny';
      if (mode === 'deny') throw new Error('入口动作尚未授权：' + action.name);
      resources.push({
        id: 'action:' + action.id,
        name: action.name,
        kind: 'action',
        access: mode,
        detail:
          action.description + (mode === 'confirm' ? '；执行时仍须人工确认' : '；按现有授权执行'),
      });
    }
    const identities: PathIdentity[] = [];
    for (const requirement of [...paths.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      let real: string;
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        real = await realpath(requirement.path);
        info = await stat(real);
        if (requirement.kind === 'file' ? !info.isFile() : !info.isDirectory())
          throw new Error('资源类型不符：' + requirement.name);
        await access(
          real,
          (requirement.read ? constants.R_OK : 0) |
            (requirement.write ? constants.W_OK : 0) |
            (requirement.kind === 'directory' ? constants.X_OK : 0),
        );
      } catch (reason) {
        throw new Error(
          '本机资源不可用：' +
            requirement.name +
            '\n' +
            (this.deps.error ?? redactedErrorText)(reason),
        );
      }
      identities.push({
        ...requirement,
        real,
        dev: info.dev,
        ino: info.ino,
        ...(requirement.kind === 'file' ? { size: info.size, mtimeMs: info.mtimeMs } : {}),
      });
      resources.push({
        id: requirement.id,
        name: requirement.name,
        kind: requirement.kind,
        location: real,
        access:
          requirement.read && requirement.write
            ? 'readwrite'
            : requirement.write
              ? 'write'
              : 'read',
        detail: '已核对类型与系统访问权限',
      });
    }
    const browsers: BrowserBinding[] = [];
    let embedded: EmbeddedReview | undefined;
    for (const id of [...browserIds].sort()) {
      const binding = this.store.get<BrowserBinding>('browser', id);
      if (!binding) throw new Error('浏览器绑定不存在：' + id);
      browsers.push(binding);
      if (binding.product === 'embedded') {
        embedded ??= await this.deps.embedded();
        if (
          !embedded ||
          typeof embedded.started !== 'boolean' ||
          typeof embedded.loading !== 'boolean' ||
          !Number.isSafeInteger(embedded.documentRevision)
        )
          throw new Error('未取得内置网页身份，请重新检查');
        if (embedded.blocked || embedded.loading)
          throw new Error(embedded.blocked || '内置网页正在加载，请稍后重新检查');
        if (embedded.started && !embedded.resourceId) throw new Error('内置网页资源身份不完整');
      }
      resources.push({
        id: 'browser:' + id,
        name: binding.product === 'embedded' ? '内置网页' : binding.product,
        kind: 'browser',
        access: 'use',
        detail:
          binding.product === 'embedded'
            ? embedded!.started
              ? `${embedded!.title || '当前网页'} · ${embedded!.url}`
              : '尚未打开，按流程步骤导航'
            : `已选 ${binding.version}；运行时使用专用会话`,
        location: binding.product === 'embedded' ? undefined : binding.executable,
      });
    }
    for (const id of [...new Set(record.bindings.credentials)].sort())
      resources.push({
        id: 'credential:' + id,
        name: id,
        kind: 'credential',
        access: 'use',
        detail: '只核对凭据引用，不显示密钥',
      });
    return {
      resources,
      desktop,
      authorization: {
        ...(record.toolTargets?.length
          ? {
              tools: record.toolTargets.map((target) => ({
                selectionId: target.selectionId,
                connectionRevision: target.connectionRevision,
                capabilityDigest: target.capabilityDigest,
              })),
            }
          : {}),
        ...(desktop
          ? {
              desktop: {
                bindingId: desktop.bindingId,
                expiresAt: desktop.expiresAt,
                windowTitle: desktop.windowTitle,
                sourceHash: desktop.sourceHash,
                replacementHash: desktop.replacementHash,
              },
            }
          : {}),
        ...(target ? { target: await this.verifyTarget(target) } : {}),
        paths: identities,
        browsers,
        ...(embedded ? { embedded } : {}),
        ...(template ? { template } : {}),
      } satisfies Authorization,
    };
  }

  private async prepare(args: RunReviewInput) {
    const captured = this.capture(args);
    const before = await this.environment(captured.record, captured.target);
    if (this.capture(args).signature !== captured.signature)
      throw new Error('检查期间流程或任务已改变，请重新检查');
    const prepared = await this.deps.preflight(captured.record);
    const after = await this.environment(captured.record, captured.target);
    if (
      this.capture(args).signature !== captured.signature ||
      digest(before.authorization) !== digest(after.authorization)
    )
      throw new Error('检查期间流程、授权或资源已改变，请重新检查');
    return {
      ...captured,
      ...after,
      prepared,
      token: digest({
        signature: captured.signature,
        authorization: after.authorization,
        bundles: prepared.scriptBundles,
        ...(prepared.templateData ? { templateData: prepared.templateData } : {}),
        ...(prepared.authorSdk ? { authorSdk: prepared.authorSdk } : {}),
      }),
    };
  }

  async preview(input: unknown): Promise<RunReviewPreview> {
    const args = runReviewPreviewSchema.parse(input);
    const record = this.store.get<FlowRecord>('flow', args.id);
    if (!record) throw new Error('已保存流程不存在');
    const result: RunReviewPreview = {
      ready: false,
      debug: !!args.debug,
      task: args.task,
      flow: {
        id: record.id,
        name: record.flow.name,
        stepCount: walk(record.flow.steps).length,
        parameterNames: Object.keys(record.flow.parameters).sort(),
        capabilities: record.flow.requiredCapabilities,
        scriptBundles: [],
      },
      resources: [],
      effects: reviewEffects(record.flow),
      checks: [],
      limitations,
    };
    result.toolCalls = reviewToolCalls(record, this.deps.tools?.(record));
    const desktopNode = record.flow.steps.find((node) => node.type === 'desktop');
    if (desktopNode?.type === 'desktop' && record.desktopTarget)
      result.desktop = { flowHash: planningFlowHash(record), replacement: desktopNode.text };
    try {
      const prepared = await this.prepare(args);
      result.ready = true;
      result.token = prepared.token;
      result.flow.versionId = executionVersion(prepared.record, prepared.prepared);
      result.flow.scriptBundles = prepared.prepared.scriptBundles;
      result.resources = prepared.resources;
      if (prepared.prepared.authorSdk) {
        const sdk = prepared.prepared.authorSdk;
        result.resources.push({
          id: 'author-sdk',
          name: '作者调试结果与提醒',
          kind: 'action',
          access: '本机记录',
          detail: `固定入口 ${sdk.owner.entryId} / 制作修订 ${sdk.owner.baseRevision}；结果及提醒只属本副本，不进入正式实例或公开ZIP。其余SDK须在正式实例配置。`,
        });
      }
      if (prepared.prepared.templateData) {
        const context = prepared.prepared.templateData;
        result.resources.push({
          id: 'template-data',
          name: '配置与状态',
          kind: 'action',
          access: walk(prepared.record.flow.steps).some(
            (n) => n.type === 'context' && n.operation === 'state.write',
          )
            ? '读写'
            : '只读',
          detail: `${context.owner.kind === 'author-checkout' ? '本制作副本的私有调试值' : '当前模板实例'}；配置固定修订 ${context.configurationRevision}；状态读取最新修订，写入须核对预期修订。`,
        });
      }
      if (result.desktop && prepared.desktop)
        result.desktop = {
          ...result.desktop,
          bindingId: prepared.desktop.bindingId,
          expiresAt: prepared.desktop.expiresAt,
          windowTitle: prepared.desktop.windowTitle,
          original: prepared.desktop.original,
        };
      if (prepared.rerun)
        result.rerun = {
          runId: prepared.rerun.id,
          name: prepared.rerun.name,
          state: prepared.rerun.state,
        };
      result.checks.push({
        name: '当前流程与资源',
        passed: true,
        detail: '已核对保存内容、当前授权、资源身份和所需能力；确认时再次检查。',
      });
    } catch (error) {
      result.checks.push({
        name: '尚不能开始试运行',
        passed: false,
        detail: (this.deps.error ?? redactedErrorText)(error),
      });
    }
    return result;
  }

  private previous(args: RunReviewConfirmation, fingerprint: string) {
    const previous = this.store.get<RequestRecord>('flow-run-request', args.requestId);
    if (!previous) return;
    if (previous.fingerprint !== fingerprint)
      throw new Error('requestId 已用于不同的试运行确认内容');
    const run = this.store.get<Run>('run', previous.runId);
    if (!run) throw new Error('试运行确认记录不完整，已阻止重复执行');
    return run;
  }
  async confirmOutcome(input: unknown, assertAdmission: () => void): Promise<RunReviewOutcome> {
    const args = runReviewConfirmSchema.parse(input);
    try {
      return await this.confirm(args, assertAdmission);
    } catch (error) {
      // A post-commit failure (including dispatch) must still report the Run that
      // exists. Failed storage or an incomplete receipt cannot prove rejection.
      const fingerprint = digest({ ...args, debug: !!args.debug });
      const record = this.store.get<RequestRecord>('flow-run-request', args.requestId);
      if (record?.fingerprint === fingerprint) return this.previous(args, fingerprint)!;
      if (this.store.fault) throw error;
      return { rejected: true, message: (this.deps.error ?? redactedErrorText)(error) };
    }
  }
  /** Runtime serializes admissions. The durable request lookup precedes all admission checks. */
  async confirm(input: unknown, assertAdmission: () => void = () => {}): Promise<Run> {
    const args = runReviewConfirmSchema.parse(input),
      fingerprint = digest({ ...args, debug: !!args.debug });
    const previous = this.previous(args, fingerprint);
    if (previous) return previous;
    assertAdmission();
    // Confirm's extra fields are not part of selection or the preview token.
    const selection: RunReviewInput = {
      id: args.id,
      debug: args.debug,
      task: args.task,
      rerun: args.rerun,
    };
    const captured = await this.prepare(selection);
    assertAdmission();
    if (captured.token !== args.token) throw new Error('试运行检查已过期，请重新检查并核对');
    const nextId = uid();
    const hasDesktop = !!captured.authorization.desktop;
    if (hasDesktop && !args.desktopReviewed) throw new Error('请明确授权本次原选区替换与回读');
    const hasTools = walk(captured.record.flow.steps).some((node) => node.type === 'mcp');
    if (hasTools && !args.toolsReviewed) throw new Error('请明确确认本次工具、参数来源与外部影响');
    let claimed = false;
    try {
      if (hasDesktop) {
        claimed = true;
        await this.deps.desktop!.claim(captured.record, nextId);
      }
      const run = this.store.tx(() => {
        const duplicate = this.previous(args, fingerprint);
        if (duplicate) return duplicate;
        assertAdmission();
        if (this.capture(selection).signature !== captured.signature)
          throw new Error('试运行检查已过期，请重新检查');
        const time = now(),
          versionId = this.deps.version(captured.record, captured.prepared);
        const next: Run = {
          id: nextId,
          flowId: args.id,
          name: captured.record.flow.name,
          versionId,
          state: 'QUEUED',
          createdAt: time,
          updatedAt: time,
          source: 'manual',
          debug: !!args.debug,
          review: {
            reviewedAt: time,
            ...(hasDesktop ? { desktopReviewed: true as const } : {}),
            ...(hasTools ? { toolsReviewed: true as const } : {}),
          },
          ...(args.task ? { task: args.task } : {}),
          ...(captured.rerun
            ? { rerun: { runId: captured.rerun.id, mode: 'saved' as const, reviewedAt: time } }
            : {}),
          business: '已核对后开始试运行；执行结果与外部业务核对分别记录',
        };
        this.store.put('snapshot', next.id, {
          ...captured.record,
          ...captured.prepared,
          versionId,
          runReviewAuthorization: captured.authorization,
        });
        this.store.put('run', next.id, next);
        this.store.event(next.id, 'state', '', { state: 'QUEUED' });
        this.store.put('flow-run-request', args.requestId, {
          requestId: args.requestId,
          fingerprint,
          runId: next.id,
        } satisfies RequestRecord);
        this.deps.learnedTrial?.(next);
        return next;
      });
      if (claimed && run.id !== nextId) await this.deps.desktop!.release(captured.record, nextId);
      this.deps.dispatch();
      return run;
    } catch (error) {
      if (claimed && !this.store.get('run', nextId))
        await this.deps.desktop!.release(captured.record, nextId);
      throw error;
    }
  }

  async checkExecution(run: Run, snapshot: Snapshot) {
    if (!run.review) return;
    const current = this.store.get<FlowRecord>('flow', run.flowId);
    if (!current || !snapshot.runReviewAuthorization)
      throw new Error('试运行授权已失效，请重新检查');
    assertRerunBindings(snapshot.bindings, current.bindings);
    const environment = await this.environment(
      snapshot,
      snapshot.runReviewAuthorization.target,
      run.id,
    );
    const latest = this.store.get<FlowRecord>('flow', run.flowId);
    if (!latest) throw new Error('当前流程已删除，试运行授权失效');
    assertRerunBindings(snapshot.bindings, latest.bindings);
    if (digest(snapshot.runReviewAuthorization) !== digest(environment.authorization))
      throw new Error('试运行资源或网页已改变，请重新检查');
  }

  private async verifyTarget(target: RepairSelection) {
    if (!this.deps.target) throw new Error('修复目标复核不可用');
    const current = await this.deps.target(target);
    if (digest(current) !== digest(target)) throw new Error('修复目标已变化，请重新选择');
    return current;
  }
}
