import type { Templates } from '../templates/service';
import type { TemplateSave } from '../shared/ipc';
import type { DirectoryBindingDraft } from './directory-binding-draft';
export type TemplateDetail = Awaited<ReturnType<Templates['detail']>> & {
  directoryDraft?: DirectoryBindingDraft;
};
export type TemplateSaveScope = 'configuration' | 'resources' | 'instance' | 'input' | 'all';
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function templateSaveRequest(
  draft: TemplateDetail,
  saved: TemplateDetail,
  scope: TemplateSaveScope,
  entryId?: string,
): TemplateSave {
  const instance = { ...saved.instance };
  for (const field of templateFields(scope)) (instance as any)[field] = draft.instance[field];
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
    if (
      !templateFields(scope).includes(field) ||
      !equal(current.instance[field], submitted.instance[field])
    )
      (instance as any)[field] = current.instance[field];
  return {
    ...next,
    instance,
    directoryDraft:
      templateFields(scope).includes('resources') &&
      equal(current.instance.resources, submitted.instance.resources) &&
      equal(current.directoryDraft, submitted.directoryDraft)
        ? undefined
        : current.directoryDraft,
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

export function templateFields(scope: TemplateSaveScope) {
  const fields = ['name', 'configuration', 'resources', 'grants'] as const;
  return fields.filter(
    (field) =>
      scope === 'all' ||
      scope === 'instance' ||
      (scope === 'configuration' && (field === 'name' || field === 'configuration')) ||
      (scope === 'resources' && (field === 'resources' || field === 'grants')),
  );
}
export function templateDirty(draft: TemplateDetail, saved: TemplateDetail) {
  return (
    !equal(draft.instance, saved.instance) ||
    draft.entries.some(
      (entry) => !equal(entry.values, saved.entries.find((e) => e.id === entry.id)?.values),
    )
  );
}
