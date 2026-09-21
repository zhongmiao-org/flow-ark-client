import type { Templates } from '../templates/service';
import type { TemplateSave } from '../shared/ipc';
export type TemplateDetail = Awaited<ReturnType<Templates['detail']>>;
export type TemplateSaveScope = 'configuration' | 'input' | 'all';
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function templateSaveRequest(
  draft: TemplateDetail,
  saved: TemplateDetail,
  scope: TemplateSaveScope,
  entryId?: string,
): TemplateSave {
  const instance = scope === 'input' ? saved.instance : draft.instance;
  return {
    id: saved.instance.id,
    revision: saved.revision,
    name: instance.name,
    configuration: instance.configuration,
    resources: instance.resources,
    grants: instance.grants,
    inputs: Object.fromEntries(
      draft.entries
        .filter((entry) =>
          scope === 'input'
            ? entry.id === entryId
            : scope === 'all' &&
              !equal(entry.values, saved.entries.find((e) => e.id === entry.id)?.values),
        )
        .map((entry) => [entry.id, entry.values]),
    ),
  };
}
// A save response advances the baseline without discarding other local drafts or
// edits made while that request was in flight.
export function acceptTemplateSave(
  current: TemplateDetail,
  submitted: TemplateDetail,
  next: TemplateDetail,
  request: TemplateSave,
  scope: TemplateSaveScope,
): TemplateDetail {
  const instance = { ...next.instance };
  for (const field of ['name', 'configuration', 'resources', 'grants'] as const)
    if (scope === 'input' || !equal(current.instance[field], submitted.instance[field]))
      (instance as any)[field] = current.instance[field];
  return {
    ...next,
    instance,
    entries: next.entries.map((entry) => {
      const currentEntry = current.entries.find((e) => e.id === entry.id);
      return currentEntry &&
        (!Object.hasOwn(request.inputs, entry.id) ||
          !equal(currentEntry.values, submitted.entries.find((e) => e.id === entry.id)?.values))
        ? { ...entry, values: currentEntry.values }
        : entry;
    }),
  };
}
