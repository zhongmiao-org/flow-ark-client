import { join, dirname, resolve, relative } from 'node:path';
import { readFile, writeFile, realpath, stat, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from '../host/store';
import { PackageLibrary, type InstalledPackage } from './archive';
import {
  jsonFile,
  materializeFlow,
  validateData,
  sha256,
  type PackageData,
  type Entry,
} from '../../contracts/package-format';
import { schemaDefaults, validateConfigurationSchema } from '../shared/template-config';
import { capabilities, validateFlow } from '../core/validate';
import { generate } from '../ai/providers';
import type { Bindings, FlowRecord, Run } from '../shared/types';
import type { TemplateInstance } from './types';
export class Templates {
  readonly library: PackageLibrary;
  private mutations: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(fn);
    this.mutations = next.catch(() => {});
    return next;
  }
  install(token: string) {
    return this.exclusive(() => this.installOne(token));
  }
  create(key: string, copyFrom?: string) {
    return this.exclusive(() => this.createOne(key, copyFrom));
  }
  remove(key: string) {
    return this.exclusive(() => this.removeOne(key));
  }
  private questions = new Map<
    string,
    { runId: string; resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  constructor(
    private store: Store,
    dataPath: string,
    version: string,
    private notify: () => Promise<any> = async () => {},
  ) {
    this.library = new PackageLibrary(join(dataPath, 'template-packages'), version);
  }
  list() {
    return this.store.list<InstalledPackage>('template-package');
  }
  instances() {
    return this.store.list<TemplateInstance>('template-instance');
  }
  private async installOne(token: string) {
    const p = await this.library.install(token);
    const old = this.store.get<InstalledPackage>('template-package', p.key);
    if (!old) {
      try {
        this.store.put('template-package', p.key, p);
      } catch (error) {
        await this.library.remove(p.key);
        throw error;
      }
    }
    return old ?? p;
  }
  private async removeOne(key: string) {
    for (const kind of ['template-instance', 'flow', 'version', 'snapshot'])
      for (const r of this.store.list<any>(kind))
        if (r.packageKey === key || r.bindings?.template?.packageKey === key)
          throw new Error('模板版本被实例、计划或运行引用，不能删除');
    await this.library.remove(key);
    this.store.remove('template-package', key);
  }
  private async createOne(key: string, copyFrom?: string) {
    const pkg = await this.library.load(key),
      m = pkg.manifest;
    const configSchema = jsonFile(pkg.files, m.configurationSchema);
    validateConfigurationSchema(configSchema);
    let configuration = schemaDefaults(configSchema);
    if (copyFrom) {
      const old = this.store.get<TemplateInstance>('template-instance', copyFrom);
      if (!old) throw new Error('原实例不存在');
      try {
        validateData(configSchema, old.configuration);
        configuration = structuredClone(old.configuration);
      } catch {}
    }
    const instance: TemplateInstance = {
      id: randomUUID(),
      packageKey: key,
      name: m.name,
      configuration,
      resources: {},
      grants: Object.fromEntries(m.actions.map((a) => [a.id, 'deny'])),
      entryFlows: Object.fromEntries(m.entries.map((e) => [e.id, randomUUID()])),
      createdAt: new Date().toISOString(),
    };
    this.store.tx(() => {
      this.store.put('template-instance', instance.id, instance);
      this.writeFlows(pkg, instance);
      this.store.put(
        'template-state',
        instance.id,
        schemaDefaults(jsonFile(pkg.files, m.stateSchema)),
      );
    });
    return instance;
  }
  private writeFlows(pkg: PackageData, instance: TemplateInstance) {
    for (const entry of pkg.manifest.entries) {
      const flow = materializeFlow(pkg, entry.id);
      flow.id = instance.entryFlows[entry.id];
      flow.name = instance.name + ' · ' + entry.name;
      flow.sourceTemplate = {
        id: pkg.manifest.id,
        version: pkg.manifest.version,
        digest: pkg.manifest.contentDigest,
      };
      const previous = this.store.get<FlowRecord>('flow', flow.id); // Preserve local edits when instance bindings change.
      const files: Record<string, string> = {},
        credentials: string[] = [];
      let browserId: string | undefined;
      for (const id of entry.resources) {
        const r = pkg.manifest.resources.find((r) => r.id === id)!;
        const v = instance.resources[id];
        if (!v) continue;
        if (v.path) files[id] = v.path;
        if (r.kind === 'browser') browserId = v.browserId;
        if (v.provider) credentials.push(v.provider);
      }
      const bindings: Bindings = {
        files,
        credentials: [...new Set(credentials)],
        browserId,
        resources: structuredClone(instance.resources),
        grants: structuredClone(instance.grants),
        template: {
          instanceId: instance.id,
          packageKey: instance.packageKey,
          entryId: entry.id,
          digest: pkg.manifest.contentDigest,
        },
        configuration: {
          adapter: 'template-instance-v1',
          schema: jsonFile(pkg.files, pkg.manifest.configurationSchema),
          values: structuredClone(instance.configuration),
        },
      };
      this.store.put('flow', flow.id, {
        id: flow.id,
        flow: previous?.flow ?? flow,
        bindings,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  async detail(id: string) {
    const instance = this.store.get<TemplateInstance>('template-instance', id);
    if (!instance) throw new Error('实例不存在');
    const pkg = await this.library.load(instance.packageKey);
    return {
      instance,
      manifest: pkg.manifest,
      configurationSchema: jsonFile(pkg.files, pkg.manifest.configurationSchema),
      entries: pkg.manifest.entries.map((e) => ({
        ...e,
        input: jsonFile(pkg.files, e.inputSchema),
        values: this.store.get<FlowRecord>('flow', instance.entryFlows[e.id])?.flow.parameters,
        unavailable: e.capabilities.filter((c) => !capabilities.includes(c)),
      })),
    };
  }
  async input(id: string, entryId: string, value: any) {
    const { instance } = await this.detail(id);
    const pkg = await this.library.load(instance.packageKey);
    const entry = pkg.manifest.entries.find((e) => e.id === entryId);
    if (!entry) throw new Error('入口不存在');
    validateData(jsonFile(pkg.files, entry.inputSchema), value);
    const record = this.store.get<FlowRecord>('flow', instance.entryFlows[entryId])!;
    record.flow.parameters = value;
    validateFlow(record.flow);
    this.store.put('flow', record.id, record);
    return true;
  }
  async configure(
    id: string,
    configuration: any,
    resources: TemplateInstance['resources'],
    grants: TemplateInstance['grants'],
  ) {
    const { instance, manifest } = await this.detail(id),
      pkg = await this.library.load(instance.packageKey);
    validateData(jsonFile(pkg.files, manifest.configurationSchema), configuration);
    for (const key of Object.keys(resources))
      if (!manifest.resources.some((r) => r.id === key)) throw new Error('未知资源绑定');
    for (const key of Object.keys(grants))
      if (
        !manifest.actions.some((a) => a.id === key) ||
        !['deny', 'confirm', 'auto'].includes(grants[key])
      )
        throw new Error('未知动作或授权');
    const next: TemplateInstance = {
      ...instance,
      configuration,
      resources,
      grants: {
        ...Object.fromEntries(manifest.actions.map((a) => [a.id, 'deny' as const])),
        ...grants,
      },
    };
    this.store.tx(() => {
      this.store.put('template-instance', id, next);
      this.writeFlows(pkg, next);
    });
    return next;
  }
  async context(record: FlowRecord) {
    const ref = record.bindings.template;
    if (!ref) throw new Error('此流程没有模板实例');
    const instance = this.store.get<TemplateInstance>('template-instance', ref.instanceId);
    if (
      !instance ||
      instance.packageKey !== ref.packageKey ||
      instance.entryFlows[ref.entryId] !== record.id
    )
      throw new Error('模板入口与实例不匹配');
    const pkg = await this.library.load(ref.packageKey);
    if (pkg.manifest.contentDigest !== ref.digest) throw new Error('固定模板摘要不匹配');
    const entry = pkg.manifest.entries.find((e) => e.id === ref.entryId);
    if (!entry) throw new Error('入口不存在');
    return { ref, pkg, entry };
  }
  async preflight(record: FlowRecord, scheduled = false) {
    if (!record.bindings.template) return;
    const { pkg, entry } = await this.context(record);
    if (scheduled && !entry.schedulable) throw new Error('入口不支持定时执行');
    for (const cap of entry.capabilities)
      if (!capabilities.includes(cap)) throw new Error('入口缺少能力：' + cap);
    validateData(
      jsonFile(pkg.files, pkg.manifest.configurationSchema),
      record.bindings.configuration?.values,
    );
    validateData(jsonFile(pkg.files, entry.inputSchema), record.flow.parameters);
    for (const id of entry.actions)
      if (!record.bindings.grants?.[id] || record.bindings.grants[id] === 'deny')
        throw new Error('入口动作尚未授权：' + id);
    for (const id of entry.resources) {
      const declaration = pkg.manifest.resources.find((r) => r.id === id)!;
      const binding = record.bindings.resources?.[id];
      if (!binding) {
        if (declaration.required) throw new Error('入口缺少资源绑定：' + id);
        continue;
      }
      if (['file', 'directory'].includes(declaration.kind)) {
        if (!binding.path) throw new Error('文件路径未绑定');
        const info = await stat(binding.path);
        if (declaration.kind === 'file' ? !info.isFile() : !info.isDirectory())
          throw new Error('绑定资源类型不符');
      }
      if (declaration.kind === 'ai' && (!binding.provider || !binding.model))
        throw new Error('AI 供应商和模型未配置');
      if (declaration.kind === 'browser' && !this.store.get('browser', binding.browserId ?? ''))
        throw new Error('浏览器绑定不存在');
    }
  }
  async canWrite(record: FlowRecord, runId: string, signal?: AbortSignal) {
    if (!record.bindings.template) return;
    const { entry } = await this.context(record);
    if (!entry.actions.length) throw new Error('入口未声明写入动作');
    for (const action of entry.actions) {
      const grant = record.bindings.grants?.[action];
      if (grant === 'auto') continue;
      if (grant === 'confirm') {
        if (this.store.get('template-approval', runId + ':' + action)) continue;
        if (
          signal &&
          (await this.human(
            runId,
            { title: '确认：' + action, schema: { type: 'boolean' } },
            signal,
          ))
        ) {
          this.store.put('template-approval', runId + ':' + action, { runId, action });
          continue;
        }
      }
      throw new Error('写入动作尚未确认：' + action);
    }
  }
  async answer(id: string, value: any) {
    const pending = this.questions.get(id);
    if (!pending) throw new Error('该人工请求已失效');
    const item = this.store.get<any>('attention', id);
    validateData(item.detail.schema, value);
    this.questions.delete(id);
    this.store.put('attention', id, {
      ...item,
      read: true,
      detail: { ...item.detail, answered: true },
    });
    pending.resolve(value);
  }
  private async human(runId: string, request: any, signal: AbortSignal) {
    if (typeof request.title !== 'string' || request.title.length > 200)
      throw new Error('人工请求标题无效');
    const schema = request.schema ?? { type: 'boolean' };
    const item = this.store.attention(
      'template-input',
      request.title,
      { runId, schema, description: request.description ?? '', answered: false },
      runId + ':' + randomUUID(),
    );
    this.store.state(runId, 'WAITING_INPUT');
    void this.notify().catch(() => {});
    try {
      return await new Promise((resolve, reject) => {
        const abort = () => {
          cleanup();
          this.questions.delete(item.id);
          reject(new Error('人工等待已取消或超时'));
        };
        const timer = setTimeout(abort, 10 * 60 * 1000);
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
        };
        this.questions.set(item.id, {
          runId,
          resolve: (v) => {
            cleanup();
            resolve(v);
          },
          reject: (e) => {
            cleanup();
            reject(e);
          },
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
          cleanup();
          abort();
        }
      });
    } finally {
      this.questions.delete(item.id);
      const run = this.store.get<Run>('run', runId);
      if (run?.state === 'WAITING_INPUT' && !signal.aborted) this.store.state(runId, 'RUNNING');
    }
  }
  async call(
    record: FlowRecord,
    runId: string,
    args: any,
    signal: AbortSignal,
    services: {
      browser: (bindingId: string, command: any) => Promise<any>;
      credential: (id: string) => Promise<string>;
      artifact: (name: string, content: string) => Promise<any>;
    },
  ) {
    const { pkg, entry, ref } = await this.context(record);
    signal.throwIfAborted();
    if (!args || typeof args.operation !== 'string') throw new Error('模板 SDK 请求无效');
    const need = (cap: string) => {
      if (!entry.capabilities.includes(cap)) throw new Error('入口未声明能力：' + cap);
    };
    const resource = (kind: string) => {
      const d = pkg.manifest.resources.find((r) => r.id === args.resourceId);
      if (!d || !entry.resources.includes(d.id) || d.kind !== kind)
        throw new Error('资源不属于当前入口');
      const binding = record.bindings.resources?.[d.id];
      if (!binding) throw new Error('资源未绑定');
      return { d, binding };
    };
    switch (args.operation) {
      case 'configuration':
        return structuredClone(record.bindings.configuration?.values ?? {});
      case 'resource': {
        const b = pkg.files.get(args.path);
        if (!b || args.path === 'manifest.json') throw new Error('包内资源不存在');
        return b.toString('utf8');
      }
      case 'validate':
        return validateData(jsonFile(pkg.files, args.path), args.value);
      case 'state.get':
        need('state');
        return this.store.get('template-state', ref.instanceId);
      case 'state.set':
        need('state');
        validateData(jsonFile(pkg.files, pkg.manifest.stateSchema), args.value);
        signal.throwIfAborted();
        this.store.put('template-state', ref.instanceId, args.value);
        return true;
      case 'browser': {
        need('browser');
        const { binding } = resource('browser');
        const op = args.command?.operation;
        if (
          ![
            'url',
            'navigate',
            'read',
            'count',
            'attribute',
            'inputValue',
            'wait',
            'click',
            'fill',
            'select',
            'check',
            'press',
          ].includes(op)
        )
          throw new Error('SDK 浏览器操作不支持');
        if (['click', 'fill', 'select', 'check', 'press'].includes(op))
          await this.canWrite(record, runId, signal);
        return services.browser(binding.browserId!, { selector: '', value: null, ...args.command });
      }
      case 'file': {
        need('file');
        const d = pkg.manifest.resources.find((r) => r.id === args.resourceId);
        if (!d || !['file', 'directory'].includes(d.kind)) throw new Error('文件资源未声明');
        const { binding } = resource(d.kind);
        const op = args.request?.operation;
        if (!['read', 'write'].includes(op)) throw new Error('文件操作不支持');
        if (
          (op === 'write' && !['write', 'readwrite'].includes(d.access)) ||
          (op === 'read' && !['read', 'readwrite'].includes(d.access))
        )
          throw new Error('文件访问超出声明');
        const root = await realpath(binding.path!);
        let target = root;
        if (d.kind === 'directory') {
          const name = args.request.name;
          if (typeof name !== 'string' || !name || name.includes('\\'))
            throw new Error('文件名无效');
          target = resolve(root, name);
          const rel = relative(root, target);
          if (rel.startsWith('..') || !rel) throw new Error('文件越界');
          const parent = await realpath(dirname(target));
          if (parent !== root && !parent.startsWith(root + '/')) throw new Error('文件目录越界');
        }
        try {
          const actual = await realpath(target);
          if (d.kind === 'directory' && actual !== root && !actual.startsWith(root + '/'))
            throw new Error('符号链接越界');
        } catch (e: any) {
          if (e.code !== 'ENOENT' || op === 'read') throw e;
        }
        if (op === 'read') {
          if ((await stat(target)).size > 10 * 1024 * 1024) throw new Error('文件过大');
          return readFile(target, 'utf8');
        }
        await this.canWrite(record, runId, signal);
        if (
          typeof args.request.content !== 'string' ||
          Buffer.byteLength(args.request.content) > 10 * 1024 * 1024
        )
          throw new Error('输出过大');
        signal.throwIfAborted();
        await writeFile(target, args.request.content, { mode: 0o600 });
        return services.artifact(args.request.name ?? 'output.txt', args.request.content);
      }
      case 'ai': {
        need('ai');
        const { binding } = resource('ai');
        const key = await services.credential(binding.provider!);
        return generate(
          {
            provider: binding.provider!,
            model: binding.model!,
            instructions: args.request.instructions,
            input: args.request.input,
            schema: args.request.schema,
          },
          key,
          signal,
        );
      }
      case 'human':
        need('human');
        return this.human(runId, args.request, signal);
      case 'attention': {
        need('attention');
        const a = args.request;
        if (typeof a.title !== 'string' || typeof a.key !== 'string')
          throw new Error('待办参数无效');
        const item = this.store.attention(
          'template',
          a.title,
          a.detail ?? {},
          ref.instanceId + ':' + a.key,
        );
        void this.notify().catch(() => {});
        return item;
      }
      case 'effect.prepare': {
        need('effect');
        const q = args.request;
        if (!entry.actions.includes(q.action) || typeof q.key !== 'string' || !q.key)
          throw new Error('动作未声明或缺少去重键');
        const grant = record.bindings.grants?.[q.action];
        if (grant === 'deny' || !grant) throw new Error('动作未授权');
        const id = sha256(ref.instanceId + ':' + q.action + ':' + q.key),
          old = this.store.get<any>('template-effect', id);
        if (old) return { ...old, execute: false };
        if (grant === 'confirm') {
          const accepted = await this.human(
            runId,
            {
              title: '确认：' + q.action,
              description: q.description ?? '',
              schema: { type: 'boolean' },
            },
            signal,
          );
          if (!accepted) throw new Error('用户未确认动作');
          signal.throwIfAborted();
          this.store.put('template-approval', runId + ':' + q.action, { runId, action: q.action });
        }
        return this.store.tx(() => {
          const existing = this.store.get<any>('template-effect', id);
          if (existing) return { ...existing, execute: false };
          const effect = {
            id,
            instanceId: ref.instanceId,
            runId,
            action: q.action,
            key: q.key,
            state: 'submitting',
            time: new Date().toISOString(),
          };
          this.store.put('template-effect', id, effect);
          return { ...effect, execute: true };
        });
      }
      case 'effect.resolve': {
        need('effect');
        const q = args.request,
          old = this.store.get<any>('template-effect', q.id);
        if (
          !old ||
          old.instanceId !== ref.instanceId ||
          old.runId !== runId ||
          old.state !== 'submitting' ||
          !['confirmed', 'failed', 'unknown'].includes(q.state)
        )
          throw new Error('动作状态不能变更');
        this.store.put('template-effect', q.id, {
          ...old,
          state: q.state,
          evidence: q.evidence ?? null,
        });
        return true;
      }
      case 'result':
        validateData(jsonFile(pkg.files, entry.resultSchema), args.value);
        this.store.put('template-result', runId, args.value);
        return args.value;
      default:
        throw new Error('模板 SDK 方法不支持');
    }
  }
  async complete(record: FlowRecord, runId: string, output: unknown) {
    if (!record.bindings.template) return;
    const { pkg, entry } = await this.context(record);
    const value = this.store.get('template-result', runId) ?? output;
    validateData(jsonFile(pkg.files, entry.resultSchema), value);
    this.store.put('template-result', runId, value);
  }
  finish(runId: string) {
    for (const [id, q] of this.questions)
      if (q.runId === runId) {
        q.reject(new Error('运行已结束'));
        this.questions.delete(id);
      }
    for (const effect of this.store.list<any>('template-effect'))
      if (effect.runId === runId && effect.state === 'submitting')
        this.store.put('template-effect', effect.id, { ...effect, state: 'unknown' });
  }
}
