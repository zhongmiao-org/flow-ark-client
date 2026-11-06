import type { Bootstrap, FlowRecord, Run } from '../shared/types';
import type { TemplateInstance } from '../templates/types';

export type LibraryTask = {
  id: string; name: string; description: string; updatedAt: string;
  records: FlowRecord[]; instance?: TemplateInstance; version?: string;
  usage: 'task' | 'development'; issue?: string; readiness?: string; run?: Run; latestRun?: Run;
};
/** Projection only: never rewrites entry flows, references, or historical runs. */
export function libraryTasks(data: Bootstrap): LibraryTask[] {
  const projects = new Set(data.projectInstanceIds ?? []), owned = new Set<string>();
  const tasks: LibraryTask[] = data.instances.map(instance => {
    const pkg = data.templates.find(p => p.key === instance.packageKey);
    const entries = Object.entries(instance.entryFlows);
    const records = data.flows.filter(r => entries.some(([entryId, id]) => id === r.id &&
      r.bindings.template?.instanceId === instance.id && r.bindings.template.packageKey === instance.packageKey &&
      r.bindings.template.entryId === entryId));
    records.forEach(r => owned.add(r.id));
    const required = pkg?.manifest.resources.filter(r => r.required) ?? [];
    const missing = required.filter(r => {
      const v = instance.resources[r.id];
      return !v || !(v.path || v.browserId || v.provider || v.skill || v.source || v.result);
    }).length;
    const issue = !pkg ? '模板定义缺失' : records.length !== entries.length ? '入口归属或记录需检查' : undefined;
    const ids = new Set(records.map(r => r.id));
    const candidates = data.runOverview.latest.filter(r => ids.has(r.flowId));
    const latestRun = candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const observed = [...candidates, ...data.runs].find(r => ids.has(r.flowId) && r.id === data.execution?.active?.runId);
    const unsettled = candidates.find(r => ['RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING', 'QUEUED'].includes(r.state));
    const run = observed ?? unsettled ?? latestRun;
    return { id: instance.id, instance, name: instance.name, description: pkg?.manifest.description ?? '', records,
      updatedAt: records.reduce((t, r) => r.updatedAt > t ? r.updatedAt : t, instance.createdAt),
      usage: instance.usage ?? (projects.has(instance.id) ? 'development' : 'task'), version: pkg?.manifest.version,
      issue, readiness: issue ?? (missing ? `${missing} 项资源待配置` : '配置及授权需运行前核对'), run, latestRun };
  });
  for (const record of data.flows) {
    if (owned.has(record.id)) continue;
    tasks.push({ id: record.id, name: record.flow.name, description: record.flow.description ?? '',
      updatedAt: record.updatedAt, records: [record], usage: 'task',
      issue: record.bindings.template ? '所属实例或入口关联需检查' : undefined,
      run: data.runOverview.latest.find(r => r.flowId === record.id) });
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function filterTasks(tasks: LibraryTask[], filter: 'all' | 'recent' | 'template' | 'development' | 'issues', query: string, now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  return tasks.filter(t => {
    if (filter === 'issues' ? !t.issue : filter === 'development' ? t.usage !== 'development' : t.usage !== 'task') return false;
    if (filter === 'template' && !t.instance) return false;
    if (filter === 'recent' && !(Date.parse(t.updatedAt) >= start && Date.parse(t.updatedAt) <= now.getTime())) return false;
    const search = query.trim().toLocaleLowerCase();
    return [t.name, ...t.records.map(r => r.flow.name)].some(n => n.toLocaleLowerCase().includes(search));
  });
}
