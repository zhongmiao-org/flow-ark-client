import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import type { Store } from './store';
import { assertRerunBindings, executionVersion } from './run-rerun';
import { validateFlow, walk } from '../core/validate';
import { staticUploadFields, uploadText } from '../shared/upload-source';
import { digest, now, redactedErrorText, uid } from '../shared/utils';
import type { BrowserBinding, FlowRecord, PreparedScripts, Run } from '../shared/types';
import type { PlanningTask } from '../shared/planning';
import {
  runReviewConfirmSchema,
  runReviewPreviewSchema,
  type EmbeddedReview,
  type ReviewResource,
  type RunReviewConfirmation,
  type RunReviewInput,
  type RunReviewPreview,
} from '../shared/run-review';
import { reviewEffects } from './run-review-effects';

export type ReviewTemplate = {
  resources: {
    id: string;
    name: string;
    kind: 'file' | 'directory' | 'browser' | 'ai';
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
  paths: PathIdentity[];
  browsers: BrowserBinding[];
  embedded?: EmbeddedReview;
  template?: ReviewTemplate;
};
type Snapshot = FlowRecord & Partial<PreparedScripts> & { runReviewAuthorization?: Authorization };
type RequestRecord = { requestId: string; fingerprint: string; runId: string };
type Dependencies = {
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
    let task: (PlanningTask & { proposal?: unknown }) | undefined;
    if (args.task) {
      task = this.store.get('ai-task', args.task.id);
      if (!task || task.flowId !== args.id || task.revision !== args.task.revision)
        throw new Error('任务或关联流程已改变，请重新检查');
      if (task.status === 'generating' || task.proposal)
        throw new Error('任务仍在生成或有未处理提案，请先核对并采纳或拒绝');
    }
    return {
      record,
      signature: digest({
        record,
        task,
        epoch: this.deps.epoch(),
        session: this.session,
        debug: !!args.debug,
      }),
    };
  }

  private async environment(record: FlowRecord) {
    const paths = new Map<string, PathRequirement>();
    const resources: ReviewResource[] = [];
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
      if (node.type === 'file' || node.type === 'excel')
        directory(
          node.binding,
          node.operation !== 'write' || node.type === 'excel',
          node.operation !== 'read',
        );
      if (node.type === 'browser') {
        if (!record.bindings.browserId) throw new Error('请先选择本机浏览器');
        browserIds.add(record.bindings.browserId);
        if (node.operation === 'upload') {
          const fields = staticUploadFields(node.value, record.flow.parameters);
          if (fields?.binding.known)
            directory(uploadText(fields.binding.value, 'binding'), true, false);
          else for (const name of Object.keys(record.bindings.files)) directory(name, true, false);
        }
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
      const real = await realpath(requirement.path),
        info = await stat(real);
      if (requirement.kind === 'file' ? !info.isFile() : !info.isDirectory())
        throw new Error('资源类型不符：' + requirement.name);
      await access(
        real,
        (requirement.read ? constants.R_OK : 0) |
          (requirement.write ? constants.W_OK : 0) |
          (requirement.kind === 'directory' ? constants.X_OK : 0),
      );
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
      authorization: {
        paths: identities,
        browsers,
        ...(embedded ? { embedded } : {}),
        ...(template ? { template } : {}),
      } satisfies Authorization,
    };
  }

  private async prepare(args: RunReviewInput) {
    const captured = this.capture(args);
    const before = await this.environment(captured.record);
    if (this.capture(args).signature !== captured.signature)
      throw new Error('检查期间流程或任务已改变，请重新检查');
    const prepared = await this.deps.preflight(captured.record);
    const after = await this.environment(captured.record);
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
    try {
      const prepared = await this.prepare(args);
      result.ready = true;
      result.token = prepared.token;
      result.flow.versionId = executionVersion(prepared.record, prepared.prepared);
      result.flow.scriptBundles = prepared.prepared.scriptBundles;
      result.resources = prepared.resources;
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
  /** Runtime serializes admissions. The durable request lookup precedes all admission checks. */
  async confirm(input: unknown, assertAdmission: () => void = () => {}): Promise<Run> {
    const args = runReviewConfirmSchema.parse(input),
      fingerprint = digest({ ...args, debug: !!args.debug });
    const previous = this.previous(args, fingerprint);
    if (previous) return previous;
    assertAdmission();
    // Confirm's extra fields are not part of selection or the preview token.
    const selection: RunReviewInput = { id: args.id, debug: args.debug, task: args.task };
    const captured = await this.prepare(selection);
    assertAdmission();
    if (captured.token !== args.token) throw new Error('试运行检查已过期，请重新检查并核对');
    const run = this.store.tx(() => {
      const duplicate = this.previous(args, fingerprint);
      if (duplicate) return duplicate;
      assertAdmission();
      if (this.capture(selection).signature !== captured.signature)
        throw new Error('试运行检查已过期，请重新检查');
      const time = now(),
        versionId = this.deps.version(captured.record, captured.prepared);
      const next: Run = {
        id: uid(),
        flowId: args.id,
        name: captured.record.flow.name,
        versionId,
        state: 'QUEUED',
        createdAt: time,
        updatedAt: time,
        source: 'manual',
        debug: !!args.debug,
        review: { reviewedAt: time },
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
      return next;
    });
    this.deps.dispatch();
    return run;
  }

  async checkExecution(run: Run, snapshot: Snapshot) {
    if (!run.review) return;
    const current = this.store.get<FlowRecord>('flow', run.flowId);
    if (!current || !snapshot.runReviewAuthorization)
      throw new Error('试运行授权已失效，请重新检查');
    assertRerunBindings(snapshot.bindings, current.bindings);
    const environment = await this.environment(snapshot);
    const latest = this.store.get<FlowRecord>('flow', run.flowId);
    if (!latest) throw new Error('当前流程已删除，试运行授权失效');
    assertRerunBindings(snapshot.bindings, latest.bindings);
    if (digest(snapshot.runReviewAuthorization) !== digest(environment.authorization))
      throw new Error('试运行资源或网页已改变，请重新检查');
  }
}
