import { createProjectDevelopment } from './project-development';
import { mergeConfiguration } from '../projects/configuration';
import { validateData } from '../../contracts/package-format';
import { digest } from '../shared/utils';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Store } from './store';
import type { Templates } from '../templates/service';
import { archiveBytes } from '../templates/archive';
import { compileAuthor } from '../templates/author-compiler';
import { diagnoseProject, buildProject, projectRoot, projectInfo, snapshotProject, updateProjectFiles, inspectProjectTransaction, rollbackProjectTransaction, packageProject, configurationForProject } from '../projects/project';
import { ProjectDiagnostic } from '../projects/configuration';
import { templateSaveSchema } from '../shared/ipc';
import { projectMethods } from '../shared/project';
type Record = { id: string; root: string; instances: string[]; prepared?: { revision: string; instanceId: string; compilerDigest: string } };
export class ProjectWorkspace {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private templates: () => Templates, private dataPath: string,
    private runtime: (method: string, args: any) => Promise<any>,
    private confirm: (review: unknown) => Promise<boolean>, private assertIdle: (instanceId: string) => void) {}
  async attach(root: string) {
    root = await projectRoot(root);
    const info = await projectInfo(root);
    let record = this.store.list<Record>('local-project').find(p => p.root === root);
    if (!record) { record = { id: randomUUID(), root, instances: [] }; this.store.put('local-project', record.id, record); }
    return { id: record.id, root, ...info };
  }
  private record(id: string) {
    const record = this.store.get<Record>('local-project', id);
    if (!record) throw new ProjectDiagnostic('project-not-connected', '请先在客户端选择并连接工程');
    return record;
  }
  private async current(record: Record) {
    if (!record.prepared) throw new ProjectDiagnostic('project-not-prepared', '请先构建并创建调试实例');
    const snapshot = await snapshotProject(record.root);
    if (snapshot.revision !== record.prepared.revision) throw new ProjectDiagnostic('project-changed', '工程已修改，请重新构建；旧运行保持原快照');
    return this.templates().detail(record.prepared.instanceId);
  }
  async export(id: string, revision: string, destination: string) {
    return packageProject(this.record(id).root, destination, revision);
  }
  async request(method: string, value: unknown) {
    if (method === 'project.list') return this.store.list<Record>('local-project').map(r => ({ id: r.id, root: r.root }));
    const rule = projectMethods[method as keyof typeof projectMethods];
    if (!rule) throw Error('未知工程接口');
    const args = rule.parse(value) as any, record = this.record(args.id);
    if (method === 'project.get') return { id: record.id, root: record.root, ...await projectInfo(record.root) };
    if (method === 'project.read') {
      const snapshot = await snapshotProject(record.root);
      if (snapshot.revision !== args.revision) throw new ProjectDiagnostic('project-conflict', '文件已变化，请先读取新修订');
      const bytes = snapshot.files.get(args.path);
      if (!bytes || bytes.length > 2 * 1024 * 1024) throw new ProjectDiagnostic('project-read', '文件未声明或超过读取范围', args.path);
      return { revision: snapshot.revision, content: new TextDecoder('utf8', { fatal: true }).decode(bytes) };
    }
    if (method === 'project.diagnose') return diagnoseProject(record.root, args.revision, args.changes);
    if (method === 'project.check') {
      const { snapshot, pkg } = await buildProject(record.root, args.revision);
      return { revision: snapshot.revision, valid: true, contentDigest: pkg.manifest.contentDigest, scriptsExecuted: false };
    }
    if (method === 'project.write') return updateProjectFiles(record.root, args.revision, args.changes);
    if (method === 'project.transaction') return inspectProjectTransaction(record.root);
    if (method === 'project.rollback') return rollbackProjectTransaction(record.root, args.transactionId);
    if (method === 'project.prepare') {
      const job = this.queue.catch(() => {}).then(async () => {
        const current = this.record(record.id);
        const { snapshot, definition, pkg: sourcePackage } = await buildProject(record.root, args.revision);
        const compilerDigest = sourcePackage.manifest.contentDigest;
        if (!args.isolate && current.prepared && current.prepared.revision === args.revision && current.prepared.compilerDigest === compilerDigest) return this.current(current);
        definition.metadata.version += '.dev.' + snapshot.revision.slice(0, 12) + '.' + compilerDigest.slice(0, 12);
        if (!definition.metadata.version.includes('-')) definition.metadata.version = definition.metadata.version.replace('.dev.', '-dev.');
        const pkg = await compileAuthor(definition), bytes = await archiveBytes(pkg);
        const directory = join(this.dataPath, 'project-builds', record.id); await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, snapshot.revision + '-' + compilerDigest.slice(0, 12) + '.zip');
        try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
        catch (error: any) { if (error.code !== 'EEXIST' || !(await readFile(path)).equals(bytes)) throw error; }
        const preview = await this.templates().library.inspect(path), installed = await this.templates().install(preview.token);
        let instance: { id: string }, rebuildReceipt: unknown;
        if (current.prepared && !args.isolate) {
          const previous = await this.templates().detail(current.prepared.instanceId);
          this.assertIdle(previous.instance.id);
          const {initialDefaultsRepair,compatibility} = await this.templates().previewProjectRebuild(previous.instance.id, installed.key, previous.revision);
          if (!await this.confirm({ kind: 'project-rebuild', project: record.root, oldRevision: current.prepared.revision, newRevision: snapshot.revision,
            oldPackage: previous.instance.packageKey, newPackage: installed.key, ...(initialDefaultsRepair ? {initialDefaultsRepair} : {}), ...(compatibility?{compatibility}:{}), preserve: ['实例/流程标识', '配置/输入/资源/权限', '状态与修订', '回执/unknown/历史Run'] }))
            throw new ProjectDiagnostic('project-rebuild-cancelled', '未确认重建，原实例与历史保持');
          const rebuilt = await this.templates().rebuildProjectInstance(previous.instance.id, installed.key, previous.revision, () => this.assertIdle(previous.instance.id), initialDefaultsRepair?.stamp, compatibility?.compatibilityStamp);
          instance = rebuilt.instance; rebuildReceipt = rebuilt.rebuildReceipt;
        } else {
          if (args.isolate && !await this.confirm({ kind: 'project-rebuild', project: record.root, operation: '新建隔离调试实例', package: installed.key,
            defaults: '私人绑定为空、权限禁止；既有实例及业务历史保留，不自动复制或恢复' })) throw new ProjectDiagnostic('project-rebuild-cancelled', '未创建隔离实例');
          instance = await this.templates().create(installed.key);
          this.templates().setUsage(instance.id, null, 'development'); current.instances.push(instance.id);
        }
        current.prepared = { revision: snapshot.revision, instanceId: instance.id, compilerDigest };
        this.store.put('local-project', record.id, current);
        return { ...await this.templates().detail(instance.id), ...(rebuildReceipt ? { rebuildReceipt } : {}) };
      });
      this.queue = job; return job;
    }
    if (method === 'project.configure') {
      const detail = await this.current(record);
      if (detail.revision !== args.revision) throw new ProjectDiagnostic('project-conflict', '实例配置已变化，请重读');
      const resolved = await configurationForProject(record.root, { instance: args.configuration ?? detail.instance.configuration });
      const request = { id: detail.instance.id, revision: detail.revision, name: detail.instance.name,
        configuration: resolved.value, resources: args.resources ?? detail.instance.resources,
        grants: args.grants ?? detail.instance.grants, inputs: args.inputs ?? {} };
      templateSaveSchema.parse(request);
      if (!await this.confirm({ kind: 'project-configuration', project: record.root, layers: resolved.layers,
        before: { configuration: detail.instance.configuration, resources: detail.instance.resources, grants: detail.instance.grants }, proposed: request }))
        return { cancelled: true, saved: false };
      await this.current(this.record(record.id));
      return this.runtime('template.save', request);
    }
    if (method === 'project.instance') return this.current(record);
    if (method.startsWith('project.run.')) {
      if (method === 'project.run.history') return { runs: this.store.list<any>('run').filter(run => record.instances.includes(this.store.get<any>('snapshot', run.id)?.bindings?.template?.instanceId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(run => ({ id: run.id, name: run.name, state: run.state, versionId: run.versionId, createdAt: run.createdAt, batch: run.batch })) };
      if (method === 'project.run.status' || method === 'project.run.control') {
        const run = this.store.get<any>('run', args.runId), snapshot = this.store.get<any>('snapshot', args.runId);
        if (!run || !record.instances.includes(snapshot?.bindings?.template?.instanceId)) throw Error('运行不属于本工程');
        return this.runtime(method === 'project.run.status' ? 'run.detail' : 'run.control', { id: args.runId, ...(args.action ? { action: args.action } : {}) });
      }
      const detail = await this.current(record), flowId = detail.instance.entryFlows[args.entryId];
      if (!flowId) throw Error('工程入口不存在');
      const selection = { id: flowId, debug: args.debug ?? false };
      let permitId: string | undefined, development: any;
      const resolveDevelopment = async () => {
        const resolved = await configurationForProject(record.root, { instance: detail.instance.configuration, profile: args.profile, overrides: args.overrides });
        const source = this.store.get<any>('flow', flowId);
        if (!source) throw Error('开发入口流程缺失');
        const input = args.input === undefined ? source.flow.parameters : mergeConfiguration(source.flow.parameters, args.input);
        validateData(detail.entries.find((e: any) => e.id === args.entryId)!.input, input);
        return { configuration: resolved.value, input, profile: args.profile ?? null, layers: resolved.layers, source };
      };
      if (args.profile !== undefined || args.overrides !== undefined || args.input !== undefined) {
        const resolved = await resolveDevelopment();
        permitId = createProjectDevelopment(this.store, { id: record.id, revision: record.prepared!.revision }, resolved.source, resolved.configuration, resolved.input);
        development = { ...resolved, source: undefined, instanceConfiguration: detail.instance.configuration, persistedToInstance: false };
      }
      const review = permitId ? await this.runtime('flow.project.preview', { selection, permitId }) : await this.runtime('flow.run.preview', selection);
      if (method === 'project.run.preview') return { ...review, ...(development ? { development } : {}) };
      if (!review.ready) throw new ProjectDiagnostic('project-run-not-ready', JSON.stringify(review.checks));
      if (!await this.confirm(development ? { ...review, development } : review)) return { cancelled: true, runCreated: false };
      const latest = await this.current(this.record(record.id));
      if (latest.revision !== detail.revision) throw Error('核对期间实例配置或绑定变化，请重新核对');
      if (development) {
        const resolved = await resolveDevelopment();
        if (digest({ configuration: resolved.configuration, input: resolved.input }) !== digest({ configuration: development.configuration, input: development.input })) throw Error('核对期间开发配置变化，未提交运行');
      }
      const confirmation = { ...selection, token: (review as any).token, requestId: args.requestId, reviewed: true };
      return permitId ? this.runtime('flow.project.confirm', { selection: confirmation, permitId }) : this.runtime('flow.run.confirm', confirmation);
    }
    throw Error('工程操作需通过本机选择器执行');
  }
}
