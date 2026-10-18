import type { FlowRecord } from '../shared/types';
import type { TemplateSave } from '../shared/ipc';
import type { TemplateDetail } from './template-draft';
const canonical = (v: any): string =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? '[' + v.map(canonical).join(',') + ']'
      : '{' +
        Object.keys(v)
          .filter((k) => v[k] !== undefined)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',') +
        '}'
    : JSON.stringify(v);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const api = (method: string, args?: unknown) => window.flowark.request(method, args);
/** Recover only by reading the exact saved target. Never retry a potentially committed write. */
export async function saveFlowResultDraft(
  record: FlowRecord,
  choices: unknown,
  previous: FlowRecord,
): Promise<FlowRecord> {
  try {
    return await api('flow.save', {
      flow: record.flow,
      bindings: record.bindings,
      revision: record.updatedAt,
      resultSourceChoices: choices,
    });
  } catch (error) {
    const hasResult = [
      ...Object.values(previous.bindings.resources ?? {}),
      ...Object.values(record.bindings.resources ?? {}),
    ].some((v) => v.result);
    if (!hasResult) throw error;
    try {
      const boot = await api('bootstrap'),
        fresh = boot.flows.find((f: FlowRecord) => f.id === record.id);
      if (fresh && same(fresh.flow, record.flow) && same(fresh.bindings, record.bindings))
        return fresh;
    } catch {
      /* Original input remains in the form. */
    }
    throw Error(
      '结果绑定保存未取得可核对回执；当前输入保留，未自动重发。请重新打开已保存流程核对。' +
        (error instanceof Error ? ' ' + error.message : ''),
    );
  }
}
export async function saveTemplateResultDraft(
  request: TemplateSave,
  previous: TemplateDetail,
): Promise<TemplateDetail> {
  try {
    return await api('template.save', request);
  } catch (error) {
    const hasResult = [
      ...Object.values(previous.instance.resources),
      ...Object.values(request.resources),
    ].some((v) => v.result);
    if (!hasResult) throw error;
    try {
      const fresh: TemplateDetail = await api('template.detail', { id: request.id });
      if (
        fresh.instance.id === request.id &&
        fresh.instance.packageKey === previous.instance.packageKey &&
        same(fresh.instance.entryFlows, previous.instance.entryFlows) &&
        ['name', 'configuration', 'resources', 'grants'].every((k) =>
          same((fresh.instance as any)[k], (request as any)[k]),
        ) &&
        Object.entries(request.inputs).every(([id, value]) =>
          same(fresh.entries.find((e) => e.id === id)?.values, value),
        )
      )
        return fresh;
    } catch {
      /* Keep draft and short-lived choice handles; never treat an unavailable read as success. */
    }
    throw Error(
      '结果绑定保存未取得可核对回执；当前输入保留，未自动重发。请重新读取已保存实例核对。' +
        (error instanceof Error ? ' ' + error.message : ''),
    );
  }
}
