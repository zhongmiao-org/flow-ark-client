import { assertSkillRef } from '../shared/skill';
import { setInstanceState } from '../host/template-data';
import { resolveParameterSources } from '../shared/parameter-sources';
import type { TemplateSource } from '../shared/template-source';
import { join, dirname, resolve, relative } from 'node:path';
import { readFile, writeFile, realpath, stat, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from '../host/store';
import { PackageLibrary, type InstalledPackage } from './archive';
import {
  canonical,
  jsonFile,
  materializeFlow,
  validateData,
  sha256,
  type PackageData,
  type Entry,
} from '../../contracts/package-format';
import { schemaDefaults, validateConfigurationSchema } from '../shared/template-config';
import { capabilities, validateFlow, validateObject } from '../core/validate';
import { generate } from '../ai/providers';
import type { Bindings, FlowRecord, Run } from '../shared/types';
import type {
  TemplateHumanReview,
  TemplateResourceExtensionPreviewRequest,
  TemplateResourceExtensionPreviewResponse,
  TemplateResourceExtensionApplyResponse,
} from '../shared/contracts.generated';
import type { TemplateInstance } from './types';
import { templateSaveSchema, type TemplateSave } from '../shared/ipc';
import {
  assertFixedReceipt,
  deriveExtension,
  digest as extensionDigest,
  receiptValue,
  type ExtensionApplyRequest,
  type ExtensionReceipt,
} from '../../contracts/template-resource-extension.mjs';
import {
  assertExtensionReceipt,
  effectiveResourceDeclarations,
  effectiveResourceEntry,
  extensionPackageKey,
  extensionPackageReference,
  verifyResourceExtension,
} from './resource-extension';

const extensionOperationKind = 'template-resource-extension-operation';

function actionConfirmation(pkg: PackageData, entry: Entry, id: string) {
  const declaration = pkg.manifest.actions.find((action) => action.id === id);
  if (!declaration) throw Error('模板动作声明不存在，请重新核对模板包');
  const name = declaration.name.trim() || '未命名模板动作';
  const characters = Array.from(name);
  // Human request titles have a 200 UTF-16-unit limit. Keep the full name in the body.
  const titleName = characters.slice(0, 80).join('') + (characters.length > 80 ? '…' : '');
  return {
    name,
    titleName,
    description: [
      `入口：${entry.name}`,
      `动作：${name}`,
      `模板声明范围：${declaration.description.trim() || '模板未提供范围说明，请先核对固定流程并联系模板作者。'}`,
      '写入确认范围：本次运行中该动作的后续执行（包括循环），并非只确认当前一次点击。其他动作仍需分别授权。',
      '配置、资源或权限变化仍会阻止写入；本次确认不会修改实例默认权限，也不代表外部业务已受理。',
    ].join('\n\n'),
  };
}

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
  previewResourceExtension(
    request: TemplateResourceExtensionPreviewRequest,
    assertIdle: () => void,
  ): Promise<TemplateResourceExtensionPreviewResponse> {
    validateObject('TemplateResourceExtensionPreviewRequest', request);
    const args = structuredClone(request);
    return this.exclusive<TemplateResourceExtensionPreviewResponse>(async () => {
      const blocked = (error: unknown): TemplateResourceExtensionPreviewResponse => ({
        ...args,
        status: 'blocked',
        reason: (error instanceof Error ? error.message : '无法核对目录声明扩展').slice(0, 2000),
      });
      let before: ReturnType<Templates['snapshot']>;
      try {
        before = this.snapshot(args.instanceId);
        // A lost apply response must be recoverable using its old expected revision.
        const existing = before.instance.templateResourceExtension;
        if (existing) {
          this.assertRegisteredExtension(before.instance, existing);
          if (
            canonical(existing.basePackage) !== canonical(args.basePackage) ||
            canonical(existing.extensionPackage) !== canonical(args.extensionPackage)
          )
            throw Error('此实例已经接入另一份目录声明扩展，请重新读取当前实例');
          const pkg = await this.library.load(before.instance.packageKey);
          await verifyResourceExtension(pkg, existing, (key) => this.library.load(key));
          const current = this.snapshot(args.instanceId);
          if (canonical(current.instance.templateResourceExtension ?? null) !== canonical(existing))
            throw Error('已登记的目录声明扩展发生变化，请重新读取');
          this.assertCurrentExtensionRecords(current);
          return validateObject<TemplateResourceExtensionPreviewResponse>(
            'TemplateResourceExtensionPreviewResponse',
            { ...args, status: 'already-applied', receipt: structuredClone(existing) },
          );
        }
        assertIdle();
        this.assertExtensionRequest(args, before);
      } catch (error) {
        return blocked(error);
      }
      let compatible: ReturnType<typeof deriveExtension>;
      try {
        const base = await this.library.load(extensionPackageKey(args.basePackage));
        const extension = await this.library.load(extensionPackageKey(args.extensionPackage));
        this.assertExtensionPackages(args, base, extension);
        compatible = deriveExtension(base, extension);
      } catch (error) {
        return {
          ...args,
          status: 'incompatible',
          reason: (error instanceof Error ? error.message : '模板包不符合目录声明扩展条件').slice(
            0,
            2000,
          ),
        };
      }
      try {
        assertIdle();
        this.assertExtensionRequest(args, this.snapshot(args.instanceId));
        return validateObject<TemplateResourceExtensionPreviewResponse>(
          'TemplateResourceExtensionPreviewResponse',
          {
            ...args,
            status: 'compatible',
            resources: compatible.resources,
            entries: compatible.entries,
          },
        );
      } catch (error) {
        return blocked(error);
      }
    });
  }
  applyResourceExtension(
    request: ExtensionApplyRequest,
    assertIdle: () => void,
  ): Promise<TemplateResourceExtensionApplyResponse> {
    validateObject('TemplateResourceExtensionApplyRequest', request);
    const args = structuredClone(request);
    return this.exclusive<TemplateResourceExtensionApplyResponse>(async () => {
      const previous = this.store.get<ExtensionReceipt>(extensionOperationKind, args.requestId);
      if (previous) {
        assertExtensionReceipt(previous);
        if (previous.requestSha256 !== extensionDigest(args))
          throw Error('目录声明接入请求标识已经用于不同请求');
        const current = this.snapshot(args.instanceId);
        this.assertRegisteredExtension(current.instance, previous);
        this.assertCurrentExtensionRecords(current);
        return validateObject<TemplateResourceExtensionApplyResponse>(
          'TemplateResourceExtensionApplyResponse',
          { version: 1, receipt: structuredClone(previous) },
        );
      }
      assertIdle();
      this.assertExtensionRequest(args, this.snapshot(args.instanceId));
      const base = await this.library.load(extensionPackageKey(args.basePackage));
      const extension = await this.library.load(extensionPackageKey(args.extensionPackage));
      this.assertExtensionPackages(args, base, extension);
      const compatible = deriveExtension(base, extension);
      const receipt = receiptValue(args, compatible, new Date().toISOString());
      assertExtensionReceipt(receipt);
      return this.store.tx(() => {
        assertIdle();
        const current = this.snapshot(args.instanceId);
        this.assertExtensionRequest(args, current);
        if (this.store.get(extensionOperationKind, args.requestId))
          throw Error('目录声明接入请求已经变化，请核对原请求');
        for (const entry of base.manifest.entries) {
          const record = current.records[entry.id];
          const ref = record?.bindings.template;
          if (
            !record ||
            !ref ||
            record.id !== current.instance.entryFlows[entry.id] ||
            ref.instanceId !== args.instanceId ||
            ref.entryId !== entry.id ||
            ref.packageKey !== current.instance.packageKey ||
            ref.digest !== base.manifest.contentDigest ||
            record.templateResourceExtension
          )
            throw Error('原入口流程或资源声明已变化，未接入目录声明');
        }
        this.store.put(extensionOperationKind, args.requestId, receipt);
        this.store.put('template-instance', args.instanceId, {
          ...current.instance,
          templateResourceExtension: structuredClone(receipt),
        });
        for (const addition of receipt.entries) {
          const record = current.records[addition.entryId]!;
          this.store.put('flow', record.id, {
            ...record,
            templateResourceExtension: structuredClone(receipt),
            updatedAt: receipt.appliedAt,
          });
        }
        return validateObject<TemplateResourceExtensionApplyResponse>(
          'TemplateResourceExtensionApplyResponse',
          { version: 1, receipt: structuredClone(receipt) },
        );
      });
    });
  }
  private assertExtensionRequest(
    request: TemplateResourceExtensionPreviewRequest,
    snapshot: ReturnType<Templates['snapshot']>,
  ) {
    if (snapshot.instance.templateResourceExtension)
      throw Error('此实例已经接入目录声明扩展，请读取既有回执');
    if (
      snapshot.revision !== request.expectedRevision ||
      snapshot.instance.packageKey !== extensionPackageKey(request.basePackage)
    )
      throw Error('实例或原模板来源已变化，请重新读取后核对');
  }
  private assertExtensionPackages(
    request: TemplateResourceExtensionPreviewRequest,
    base: PackageData,
    extension: PackageData,
  ) {
    if (
      canonical(extensionPackageReference(base)) !== canonical(request.basePackage) ||
      canonical(extensionPackageReference(extension)) !== canonical(request.extensionPackage)
    )
      throw Error('已安装模板包与请求中的准确版本或摘要不匹配');
    this.assertExtensionPackageInstalled(request.basePackage);
    this.assertExtensionPackageInstalled(request.extensionPackage);
  }
  private assertExtensionPackageInstalled(ref: ExtensionReceipt['basePackage']) {
    const key = extensionPackageKey(ref);
    const installed = this.store.get<InstalledPackage>('template-package', key);
    if (
      !installed ||
      installed.key !== key ||
      installed.manifest.id !== ref.id ||
      installed.manifest.version !== ref.version ||
      installed.manifest.contentDigest !== ref.digest
    )
      throw Error('目录声明扩展引用的准确模板版本尚未安装');
  }
  private assertRegisteredExtension(instance: TemplateInstance, receipt: ExtensionReceipt) {
    assertExtensionReceipt(receipt);
    this.assertExtensionPackageInstalled(receipt.basePackage);
    this.assertExtensionPackageInstalled(receipt.extensionPackage);
    const operation = this.store.get<ExtensionReceipt>(extensionOperationKind, receipt.requestId);
    if (
      instance.id !== receipt.instanceId ||
      instance.packageKey !== extensionPackageKey(receipt.basePackage) ||
      canonical(instance.templateResourceExtension ?? null) !== canonical(receipt) ||
      canonical(operation ?? null) !== canonical(receipt)
    )
      throw Error('目录声明扩展没有匹配的实例与已提交回执');
  }
  private assertCurrentExtensionRecords(snapshot: ReturnType<Templates['snapshot']>) {
    const receipt = snapshot.instance.templateResourceExtension;
    if (receipt) this.assertRegisteredExtension(snapshot.instance, receipt);
    for (const [entryId, record] of Object.entries(snapshot.records)) {
      const expected = receipt?.entries.some((item) => item.entryId === entryId) ? receipt : null;
      if (canonical(record?.templateResourceExtension ?? null) !== canonical(expected))
        throw Error('实例与当前入口的目录声明扩展不一致，请保留现场核对');
    }
  }
  /** The same synchronous authority check is reused immediately before Run admission and writes. */
  assertResourceExtension(record: FlowRecord) {
    const fixed = record.templateResourceExtension;
    if (!fixed) return; // Missing historical fields never acquire the current instance extension.
    const ref = record.bindings.template;
    if (!ref) throw Error('目录声明扩展缺少原模板实例来源');
    const live = this.store.get<TemplateInstance>('template-instance', ref.instanceId);
    const current = this.store.get<FlowRecord>('flow', record.id);
    if (!live || !live.templateResourceExtension || !current?.templateResourceExtension)
      throw Error('当前实例或入口的目录声明扩展已失效');
    this.assertRegisteredExtension(live, live.templateResourceExtension);
    assertFixedReceipt(fixed, live.templateResourceExtension, ref.instanceId, ref.entryId);
    assertFixedReceipt(fixed, current.templateResourceExtension, ref.instanceId, ref.entryId);
    if (
      live.entryFlows[ref.entryId] !== record.id ||
      ref.packageKey !== extensionPackageKey(fixed.basePackage) ||
      ref.digest !== fixed.basePackage.digest ||
      canonical(current.bindings.template ?? null) !== canonical(ref)
    )
      throw Error('目录声明扩展的固定入口来源已变化');
    const addition = fixed.entries.find((item) => item.entryId === ref.entryId)!;
    for (const id of addition.resourceIds)
      if (
        canonical(live.resources[id] ?? null) !==
          canonical(record.bindings.resources?.[id] ?? null) ||
        canonical(current.bindings.resources?.[id] ?? null) !==
          canonical(record.bindings.resources?.[id] ?? null) ||
        record.bindings.files[id] !== record.bindings.resources?.[id]?.path ||
        current.bindings.files[id] !== record.bindings.resources?.[id]?.path
      )
        throw Error('目录声明扩展的当前资源绑定已变化，请返回原入口重新核对');
  }
  async resourceScope(record: FlowRecord, fixedPackage?: PackageData) {
    this.assertResourceExtension(record);
    const context = await this.context(record, fixedPackage);
    const receipt = record.templateResourceExtension;
    if (receipt)
      await verifyResourceExtension(context.pkg, receipt, (key) => this.library.load(key));
    this.assertResourceExtension(record);
    return {
      ...context,
      entry: effectiveResourceEntry(context.entry, receipt),
      resources: effectiveResourceDeclarations(context.pkg, receipt),
      ...(receipt ? { resourceExtension: receipt } : {}),
    };
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
    private sourceChanges?: (
      id: string,
      revision: string,
      before: NonNullable<Bindings['resources']>,
      next: NonNullable<Bindings['resources']>,
      allowed: string[],
    ) => void,
    private resultChanges?: (args: TemplateSave) => Promise<() => void>,
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
      for (const r of this.store.list<any>(kind)) {
        const extension = r.templateResourceExtension as ExtensionReceipt | undefined;
        if (
          r.packageKey === key ||
          r.bindings?.template?.packageKey === key ||
          (extension &&
            (extensionPackageKey(extension.basePackage) === key ||
              extensionPackageKey(extension.extensionPackage) === key))
        )
          throw new Error('模板版本被实例、计划或运行引用，不能删除');
      }
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
      name: m.name.slice(0, 100),
      configuration,
      configurationRevision: 1,
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
      this.store.put('template-state-meta', instance.id, {
        revision: 0,
        updatedAt: new Date().toISOString(),
      });
    });
    return instance;
  }
  private writeFlows(
    pkg: PackageData,
    instance: TemplateInstance,
    inputs: Record<string, unknown> = {},
  ) {
    const receipt = instance.templateResourceExtension;
    const resources = effectiveResourceDeclarations(pkg, receipt);
    for (const declaredEntry of pkg.manifest.entries) {
      const entry = effectiveResourceEntry(declaredEntry, receipt);
      const flow = materializeFlow(pkg, entry.id);
      flow.id = instance.entryFlows[entry.id];
      flow.name = (instance.name + ' · ' + entry.name).slice(0, 200);
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
        const r = resources.find((r) => r.id === id)!;
        const v = instance.resources[id];
        if (!v) continue;
        if (v.path && ['file', 'directory'].includes(r.kind)) files[id] = v.path;
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
          revision: instance.configurationRevision ?? 1,
        },
      };
      const next = { ...(previous?.flow ?? flow), name: flow.name };
      if (Object.hasOwn(inputs, entry.id)) {
        next.parameters = structuredClone(inputs[entry.id]) as any;
        validateFlow(next);
      }
      this.store.put('flow', flow.id, {
        id: flow.id,
        flow: next,
        bindings,
        ...(receipt?.entries.some((item) => item.entryId === entry.id)
          ? { templateResourceExtension: structuredClone(receipt) }
          : {}),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  // Read synchronously so the revision and returned values describe one Store state.
  private snapshot(id: string) {
    const instance = this.store.get<TemplateInstance>('template-instance', id);
    if (!instance) throw new Error('实例不存在');
    const records = Object.fromEntries(
      Object.entries(instance.entryFlows).map(([entryId, flowId]) => [
        entryId,
        this.store.get<FlowRecord>('flow', flowId) ?? null,
      ]),
    );
    const revision = sha256(canonical({ instance, records }));
    return { instance, records, revision };
  }
  sourceOwner(id: string) {
    const { instance, revision } = this.snapshot(id);
    const pkg = this.store.get<InstalledPackage>('template-package', instance.packageKey);
    if (!pkg) throw Error('实例模板来源不存在');
    return {
      revision,
      fingerprint: revision,
      resources: instance.resources,
      sourceIds: pkg.manifest.resources
        .filter((r) => r.kind === 'conversation-source' && r.access === 'read')
        .map((r) => r.id),
    };
  }
  assertSource(flowId: string, source: TemplateSource) {
    const { instance, records, revision } = this.snapshot(source.instanceId);
    if (revision !== source.revision) throw new Error('实例已变化，请返回原入口重新核对');
    const record = records[source.entryId],
      ref = record?.bindings.template;
    if (
      instance.entryFlows[source.entryId] !== flowId ||
      record?.id !== flowId ||
      ref?.instanceId !== instance.id ||
      ref?.entryId !== source.entryId ||
      ref?.packageKey !== instance.packageKey
    )
      throw new Error('原入口流程不存在或来源已变化，请返回原入口重新核对');
  }
  private describe(pkg: PackageData, snapshot: ReturnType<Templates['snapshot']>) {
    const { instance, records, revision } = snapshot;
    const receipt = instance.templateResourceExtension;
    return {
      instance,
      revision,
      manifest: pkg.manifest,
      effectiveResources: effectiveResourceDeclarations(pkg, receipt),
      ...(receipt ? { resourceExtension: structuredClone(receipt) } : {}),
      configurationSchema: jsonFile(pkg.files, pkg.manifest.configurationSchema),
      entries: pkg.manifest.entries.map((e) => {
        const input = jsonFile(pkg.files, e.inputSchema);
        const flow = records[e.id]?.flow;
        const sources = Object.entries(flow?.parameterSources ?? {}).map(
          ([name, source]) => `${name} ← ${source.$ref}`,
        );
        return {
          ...effectiveResourceEntry(e, receipt),
          // Add presentation-only guidance to the existing schema description.
          // Keep the package and its validation rules unchanged; never include values.
          input: sources.length
            ? {
                ...input,
                description: [
                  input.description,
                  `运行时以下参数由来源值覆盖：${sources.join('；')}。请修改对应来源参数；此处填写的固定值仍会保留。`,
                ]
                  .filter(Boolean)
                  .join('\n'),
              }
            : input,
          values: flow?.parameters,
          unavailable: e.capabilities.filter((c) => !capabilities.includes(c)),
        };
      }),
    };
  }
  async detail(id: string) {
    const before = this.snapshot(id);
    const pkg = await this.library.load(before.instance.packageKey);
    const current = this.snapshot(id);
    if (current.instance.packageKey !== before.instance.packageKey)
      throw new Error('实例来源已变化，请重新读取');
    await this.verifyInstanceResourceExtension(pkg, current);
    if (this.snapshot(id).revision !== current.revision) throw Error('实例已变化，请重新读取');
    return this.describe(pkg, current);
  }
  private async verifyInstanceResourceExtension(
    pkg: PackageData,
    snapshot: ReturnType<Templates['snapshot']>,
  ) {
    this.assertCurrentExtensionRecords(snapshot);
    const receipt = snapshot.instance.templateResourceExtension;
    if (receipt) await verifyResourceExtension(pkg, receipt, (key) => this.library.load(key));
  }
  save(request: TemplateSave) {
    // Validate and copy at enqueue time, before another caller can alter the draft.
    const args = structuredClone(templateSaveSchema.parse(request));
    return this.exclusive(() => this.saveOne(args));
  }
  private async saveOne(args: TemplateSave) {
    const before = this.snapshot(args.id);
    if (before.revision !== args.revision) throw new Error('实例已变化，请重新读取后保存');
    const pkg = await this.library.load(before.instance.packageKey),
      manifest = pkg.manifest;
    await this.verifyInstanceResourceExtension(pkg, before);
    const resources = effectiveResourceDeclarations(pkg, before.instance.templateResourceExtension);
    validateData(jsonFile(pkg.files, manifest.configurationSchema), args.configuration);
    for (const [key, value] of Object.entries(args.resources)) {
      const declaration = resources.find((r) => r.id === key);
      if (!declaration) throw new Error('未知资源绑定');
      const fields =
        declaration.kind === 'ai'
          ? ['provider', 'model']
          : declaration.kind === 'browser'
            ? ['browserId']
            : declaration.kind === 'conversation-source'
              ? ['source']
              : declaration.kind === 'run-result'
                ? ['result']
                : declaration.kind === 'skill'
                  ? ['path', 'skill']
                  : ['path'];
      if (declaration.kind === 'skill') {
        if (declaration.access !== 'read' || !value.path)
          throw Error('Skill资源需要确认版本及工作区');
        assertSkillRef(value.skill);
      }
      if (
        declaration.kind === 'conversation-source' &&
        (!value.source || declaration.access !== 'read')
      )
        throw Error('完整来源资源必须选择固定只读来源');
      if (Object.keys(value).some((field) => !fields.includes(field)))
        throw new Error('资源绑定类型不符');
      if (declaration.kind === 'run-result' && (!value.result || declaration.access !== 'read'))
        throw Error('已保存结果必须选择固定只读引用');
    }
    for (const key of Object.keys(args.grants))
      if (!manifest.actions.some((a) => a.id === key)) throw new Error('未知动作或授权');
    for (const [id, value] of Object.entries(args.inputs)) {
      const entry = manifest.entries.find((e) => e.id === id);
      if (!entry) throw new Error('入口不存在');
      validateData(jsonFile(pkg.files, entry.inputSchema), value);
    }
    const hasResults =
      Object.values(before.instance.resources).some((v) => v.result) ||
      Object.values(args.resources).some((v) => v.result);
    if (hasResults && !this.resultChanges) throw Error('结果绑定宿主尚未连接');
    const checkResults = hasResults ? await this.resultChanges!(args) : () => {};
    return this.store.tx(() => {
      // Package loading is asynchronous; other editor writes can occur while it runs.
      const current = this.snapshot(args.id);
      if (current.revision !== args.revision) throw new Error('实例已变化，请重新读取后保存');
      this.assertCurrentExtensionRecords(current);
      checkResults();
      if (Object.values(args.resources).some((v) => v.source)) {
        if (!this.sourceChanges) throw Error('来源绑定宿主尚未连接');
        this.sourceChanges(
          args.id,
          current.revision,
          current.instance.resources,
          args.resources,
          manifest.resources.filter((r) => r.kind === 'conversation-source').map((r) => r.id),
        );
      }
      for (const entry of manifest.entries) {
        const record = current.records[entry.id],
          ref = record?.bindings.template;
        if (
          !record ||
          !ref ||
          ref.instanceId !== args.id ||
          ref.entryId !== entry.id ||
          ref.packageKey !== current.instance.packageKey ||
          ref.digest !== manifest.contentDigest
        )
          throw new Error('原入口流程不存在或来源已变化，请重新读取');
      }
      const next: TemplateInstance = {
        ...current.instance,
        name: args.name,
        configuration: args.configuration,
        configurationRevision:
          (current.instance.configurationRevision ?? 1) +
          (canonical(current.instance.configuration) === canonical(args.configuration) ? 0 : 1),
        resources: args.resources,
        grants: {
          ...Object.fromEntries(manifest.actions.map((a) => [a.id, 'deny' as const])),
          ...args.grants,
        },
      };
      if (
        !Number.isSafeInteger(next.configurationRevision) ||
        next.configurationRevision! > Number.MAX_SAFE_INTEGER - 1
      )
        throw Error('配置修订已达上限，未保存');
      this.store.put('template-instance', args.id, next);
      this.writeFlows(pkg, next, args.inputs);
      return this.describe(pkg, this.snapshot(args.id));
    });
  }
  async context(record: FlowRecord, fixedPackage?: PackageData) {
    const ref = record.bindings.template;
    if (!ref) throw new Error('此流程没有模板实例');
    const instance = this.store.get<TemplateInstance>('template-instance', ref.instanceId);
    if (
      !instance ||
      instance.packageKey !== ref.packageKey ||
      instance.entryFlows[ref.entryId] !== record.id
    )
      throw new Error('模板入口与实例不匹配');
    const pkg = fixedPackage ?? (await this.library.load(ref.packageKey));
    if (
      pkg.manifest.id + '@' + pkg.manifest.version !== ref.packageKey ||
      pkg.manifest.contentDigest !== ref.digest
    )
      throw new Error('固定模板摘要不匹配');
    const entry = pkg.manifest.entries.find((e) => e.id === ref.entryId);
    if (!entry) throw new Error('入口不存在');
    return { ref, pkg, entry };
  }
  async preflight(record: FlowRecord, scheduled = false) {
    if (!record.bindings.template) return;
    const { pkg, entry, resources } = await this.resourceScope(record);
    if (scheduled && !entry.schedulable) throw new Error('入口不支持定时执行');
    for (const cap of entry.capabilities)
      if (!capabilities.includes(cap)) throw new Error('入口缺少能力：' + cap);
    validateData(
      jsonFile(pkg.files, pkg.manifest.configurationSchema),
      record.bindings.configuration?.values,
    );
    validateData(jsonFile(pkg.files, entry.inputSchema), resolveParameterSources(record.flow));
    for (const id of entry.actions)
      if (!record.bindings.grants?.[id] || record.bindings.grants[id] === 'deny')
        throw new Error('入口动作尚未授权：' + id);
    for (const id of entry.resources) {
      const declaration = resources.find((r) => r.id === id)!;
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
      if (declaration.kind === 'skill') {
        assertSkillRef(binding.skill);
        if (!binding.path) throw Error('Skill工作区未选择');
      }
      if (declaration.kind === 'conversation-source' && !binding.source)
        throw Error('完整来源尚未选择');
      if (declaration.kind === 'ai' && (!binding.provider || !binding.model))
        throw new Error('AI 供应商和模型未配置');
      if (declaration.kind === 'browser' && !this.store.get('browser', binding.browserId ?? ''))
        throw new Error('浏览器绑定不存在');
    }
  }
  async canWrite(
    record: FlowRecord,
    runId: string,
    signal?: AbortSignal,
    active: () => void = () => {},
    fixedPackage?: PackageData,
  ) {
    await this.writeGuard(record, runId, signal, active, fixedPackage);
  }
  /** Keep the immutable execution inputs, but never treat them as current write authority. */
  async writeGuard(
    record: FlowRecord,
    runId: string,
    signal?: AbortSignal,
    active: () => void = () => {},
    fixedPackage?: PackageData,
  ): Promise<() => void> {
    const available = () => {
      active();
      signal?.throwIfAborted();
      if (this.store.fault) throw Error(this.store.fault);
    };
    available();
    if (!record.bindings.template) return available;
    const { entry, ref, pkg } = await this.resourceScope(record, fixedPackage);
    if (!entry.actions.length) throw new Error('入口未声明写入动作');
    const fixed = structuredClone({
      flowId: record.id,
      configuration: record.bindings.configuration,
      resources: record.bindings.resources ?? {},
      grants: record.bindings.grants ?? {},
    });
    const check = () => {
      available();
      this.assertResourceExtension(record);
      const live = this.store.get<TemplateInstance>('template-instance', ref.instanceId);
      const configuration = fixed.configuration;
      if (
        !live ||
        live.packageKey !== ref.packageKey ||
        live.entryFlows[ref.entryId] !== fixed.flowId ||
        !configuration ||
        !Number.isSafeInteger(configuration.revision) ||
        configuration.revision! < 1 ||
        (live.configurationRevision ?? 1) !== configuration.revision ||
        canonical(live.configuration) !== canonical(configuration.values) ||
        entry.resources.some(
          (id) => canonical(live.resources[id] ?? null) !== canonical(fixed.resources[id] ?? null),
        ) ||
        entry.actions.some(
          (id) =>
            !['auto', 'confirm'].includes(fixed.grants[id]) || live.grants[id] !== fixed.grants[id],
        )
      )
        throw Error('本次写入范围已失效：当前权限、配置或资源已改变，请返回原入口重新核对');
    };
    check();
    for (const action of entry.actions) {
      check();
      const grant = fixed.grants[action];
      const confirmation = actionConfirmation(pkg, entry, action);
      if (grant === 'auto') continue;
      if (grant === 'confirm') {
        if (this.store.get('template-approval', runId + ':' + action)) continue;
        if (
          signal &&
          (await this.human(
            runId,
            {
              title: '允许本次运行：' + confirmation.titleName,
              description: confirmation.description,
              schema: { type: 'boolean' },
            },
            signal,
          ))
        ) {
          check();
          this.store.put('template-approval', runId + ':' + action, { runId, action });
          continue;
        }
        check();
      }
      throw new Error('写入动作尚未确认：' + confirmation.name);
    }
    check();
    return check;
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
    const review =
      request.review === undefined
        ? undefined
        : validateObject<TemplateHumanReview>('TemplateHumanReview', request.review);
    const item = this.store.attention(
      'template-input',
      request.title,
      {
        runId,
        schema,
        description: request.description ?? '',
        answered: false,
        ...(review ? { review } : {}),
      },
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
  async effectPrepare(
    record: FlowRecord,
    runId: string,
    q: any,
    signal: AbortSignal,
    active: () => void = () => {},
  ) {
    const check = () => {
      signal.throwIfAborted();
      active();
    };
    check();
    const { entry, ref, pkg } = await this.context(record);
    check();
    if (!entry.capabilities.includes('effect')) throw Error('入口未声明能力：effect');
    if (!q || typeof q !== 'object') throw Error('准备操作参数无效');
    if (q.review !== undefined) {
      if (!entry.capabilities.includes('human-review-v1'))
        throw Error('入口未声明能力：human-review-v1');
      validateObject<TemplateHumanReview>('TemplateHumanReview', q.review);
    }
    if (!entry.actions.includes(q.action) || typeof q.key !== 'string' || !q.key)
      throw Error('动作未声明或缺少去重键');
    const grant = record.bindings.grants?.[q.action];
    if (grant !== 'auto' && grant !== 'confirm') throw Error('动作未授权');
    const id = sha256(ref.instanceId + ':' + q.action + ':' + q.key),
      old = this.store.get<any>('template-effect', id);
    if (old) return { ...old, execute: false };
    if (grant === 'confirm') {
      const confirmation = actionConfirmation(pkg, entry, q.action);
      const accepted = await this.human(
        runId,
        {
          title: '准备操作：' + confirmation.titleName,
          description: [
            confirmation.description,
            '本次操作准备：确认后登记当前操作记录；后续每份操作记录仍须独立准备，同键不会重新执行。',
            ...(q.description ? [`模板提供的本次说明：\n${q.description}`] : []),
          ].join('\n\n'),
          ...(q.review !== undefined ? { review: q.review } : {}),
          schema: { type: 'boolean' },
        },
        signal,
      );
      check();
      if (!accepted) throw Error('用户未确认动作');
      this.store.put('template-approval', runId + ':' + q.action, { runId, action: q.action });
    }
    check();
    return this.store.tx(() => {
      check();
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
  async effectResolve(
    record: FlowRecord,
    runId: string,
    q: any,
    signal: AbortSignal,
    active: () => void = () => {},
  ) {
    const check = () => {
      signal.throwIfAborted();
      active();
    };
    check();
    const { entry, ref } = await this.context(record);
    check();
    if (!entry.capabilities.includes('effect')) throw Error('入口未声明能力：effect');
    const result = this.store.tx(() => {
      check();
      const old = q && this.store.get<any>('template-effect', q.id);
      if (
        !old ||
        old.instanceId !== ref.instanceId ||
        old.runId !== runId ||
        old.state !== 'submitting' ||
        !entry.actions.includes(old.action) ||
        !['confirmed', 'failed', 'unknown'].includes(q.state)
      )
        throw Error('动作状态不能变更');
      this.store.put('template-effect', q.id, {
        ...old,
        state: q.state,
        evidence: q.evidence ?? null,
      });
      if (q.state === 'unknown') this.store.templateEffectAttention(old, '模板未能确认操作结果。');
      return true;
    });
    if (q.state === 'unknown') void this.notify().catch(() => {});
    return result;
  }
  async call(
    record: FlowRecord,
    runId: string,
    args: any,
    signal: AbortSignal,
    services: {
      fixedPackage?: PackageData;
      browser: (bindingId: string, command: any, beforeDispatch?: () => void) => Promise<any>;
      credential: (id: string) => Promise<string>;
      artifact: (name: string, content: string) => Promise<any>;
      active?: () => void;
    },
  ) {
    const { pkg, entry, ref, resources } = await this.resourceScope(record, services.fixedPackage);
    signal.throwIfAborted();
    if (!args || typeof args.operation !== 'string') throw new Error('模板 SDK 请求无效');
    const need = (cap: string) => {
      if (!entry.capabilities.includes(cap)) throw new Error('入口未声明能力：' + cap);
    };
    const resource = (kind: string) => {
      const d = resources.find((r) => r.id === args.resourceId);
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
        await this.canWrite(record, runId, signal, services.active, pkg);
        signal.throwIfAborted();
        setInstanceState(this.store, ref.instanceId, args.value);
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
        const guard = ['click', 'fill', 'select', 'check', 'press'].includes(op)
          ? await this.writeGuard(record, runId, signal, services.active, pkg)
          : undefined;
        return services.browser(
          binding.browserId!,
          { selector: '', value: null, ...args.command },
          guard,
        );
      }
      case 'file': {
        need('file');
        const d = resources.find((r) => r.id === args.resourceId);
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
          services.active?.();
          signal.throwIfAborted();
          this.assertResourceExtension(record);
          return readFile(target, 'utf8');
        }
        await this.canWrite(record, runId, signal, services.active, pkg);
        if (
          typeof args.request.content !== 'string' ||
          Buffer.byteLength(args.request.content) > 10 * 1024 * 1024
        )
          throw new Error('输出过大');
        signal.throwIfAborted();
        this.assertResourceExtension(record);
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
        if (args.request?.review !== undefined) need('human-review-v1');
        return this.human(runId, args.request, signal);
      case 'attention': {
        need('attention');
        const a = args.request;
        if (!a || typeof a.title !== 'string' || typeof a.key !== 'string')
          throw new Error('待办参数无效');
        const item = this.store.attention(
          'template',
          a.title,
          a.detail === undefined ? {} : a.detail,
          ref.instanceId + ':' + a.key,
          { version: 1, runId, instanceId: ref.instanceId, entryId: entry.id },
        );
        void this.notify().catch(() => {});
        return item;
      }
      case 'effect.prepare':
        return this.effectPrepare(record, runId, args.request, signal, services.active);
      case 'effect.resolve':
        return this.effectResolve(record, runId, args.request, signal, services.active);
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
    const savedResult = this.store.get('template-result', runId);
    const value = savedResult === undefined ? output : savedResult;
    validateData(jsonFile(pkg.files, entry.resultSchema), value);
    this.store.put('template-result', runId, value);
  }
  finish(runId: string) {
    for (const [id, q] of this.questions)
      if (q.runId === runId) {
        q.reject(new Error('运行已结束'));
        this.questions.delete(id);
      }
    let unknown = false;
    this.store.tx(() => {
      for (const effect of this.store.list<any>('template-effect'))
        if (effect.runId === runId && effect.state === 'submitting') {
          this.store.put('template-effect', effect.id, { ...effect, state: 'unknown' });
          this.store.templateEffectAttention(effect, '运行已结束，但操作结果尚未确认。');
          unknown = true;
        }
    });
    if (unknown) void this.notify().catch(() => {});
  }
}
