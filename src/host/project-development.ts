import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { FlowRecord, Json } from '../shared/types';
import { digest } from '../shared/utils';
import { assertJson } from '../projects/configuration';

type Permit = {
  version: 1; id: string; projectId: string; projectRevision: string; instanceId: string; flowId: string;
  baseRecordSha256: string; baseConfigurationSha256: string; baseConfigurationRevision: number;
  configuration: Json; input: Json; configurationSha256: string; inputSha256: string;
  status: 'draft' | 'admitted'; createdAt: string; runId?: string;
};
const scope = new AsyncLocalStorage<string>();
export function withProjectDevelopment<T>(id: string, fn: () => T): T { return scope.run(id, fn); }
export function createProjectDevelopment(store: Store, project: { id: string; revision: string }, record: FlowRecord, configuration: Json, input: Json) {
  assertJson(configuration); assertJson(input);
  if (Buffer.byteLength(JSON.stringify({ configuration, input })) > 1024 * 1024) throw Error('开发运行配置与输入快照超过1MiB');
  const instanceId = record.bindings.template?.instanceId;
  if (!instanceId || !record.bindings.configuration?.revision) throw Error('开发运行需要已保存的实例配置');
  const permit: Permit = { version: 1, id: randomUUID(), projectId: project.id, projectRevision: project.revision, instanceId, flowId: record.id,
    baseRecordSha256: digest(record), baseConfigurationSha256: digest(record.bindings.configuration.values),
    baseConfigurationRevision: record.bindings.configuration.revision, configuration: structuredClone(configuration), input: structuredClone(input),
    configurationSha256: digest(configuration), inputSha256: digest(input), status: 'draft', createdAt: new Date().toISOString() };
  store.put('project-development-permit', permit.id, permit); return permit.id;
}
function permitFor(store: Store, id: string) {
  const permit = store.get<Permit>('project-development-permit', id), project = permit && store.get<any>('local-project', permit.projectId);
  if (!permit || !project?.instances?.includes(permit.instanceId) || project.prepared?.instanceId !== permit.instanceId || project.prepared?.revision !== permit.projectRevision)
    throw Error('开发运行许可来源已变化');
  return permit;
}
export function projectDevelopmentRecord(store: Store, source: FlowRecord): FlowRecord {
  const id = scope.getStore(); if (!id) return source;
  const permit = permitFor(store, id);
  if (permit.flowId !== source.id || permit.baseRecordSha256 !== digest(source)) throw Error('开发运行的基础流程或配置已变化');
  const record = structuredClone(source);
  record.bindings.configuration!.values = structuredClone(permit.configuration);
  record.flow.parameters = structuredClone(permit.input) as any;
  record.projectDevelopment = { version: 1, permitId: id }; return record;
}
export function admitProjectDevelopment(store: Store, record: FlowRecord, runId: string) {
  const id = record.projectDevelopment?.permitId; if (!id) return;
  if (scope.getStore() !== id) throw Error('开发运行缺少宿主核对上下文');
  const permit = permitFor(store, id);
  if (permit.status !== 'draft') throw Error('开发运行许可已经提交，不重复执行');
  store.put('project-development-permit', id, { ...permit, status: 'admitted', runId });
}
export function projectDevelopmentBaseMatches(store: Store, record: FlowRecord, live: { configuration: unknown; configurationRevision?: number }, runId: string) {
  const id = record.projectDevelopment?.permitId; if (!id) return false;
  const permit = permitFor(store, id), source = store.get<FlowRecord>('flow', record.id);
  return !!source && permit.status === 'admitted' && permit.runId === runId && permit.flowId === record.id &&
    permit.instanceId === record.bindings.template?.instanceId && permit.baseRecordSha256 === digest(source) &&
    permit.configurationSha256 === digest(record.bindings.configuration?.values) && permit.inputSha256 === digest(record.flow.parameters) &&
    permit.baseConfigurationRevision === (live.configurationRevision ?? 1) && permit.baseConfigurationSha256 === digest(live.configuration);
}
