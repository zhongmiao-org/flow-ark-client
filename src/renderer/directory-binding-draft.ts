import type { Manifest } from '../../contracts/package-format';
import type { Bindings } from '../shared/types';

type Resources = NonNullable<Bindings['resources']>;
/** Editor provenance only. Never sent to the host, exported or used by a Run. */
export type DirectoryBindingDraft = {
  manual: string[];
  derived: Record<string, { source: string; path: string }>;
};

export function patchResourceBinding(
  resources: Resources,
  declarations: Manifest['resources'],
  state: DirectoryBindingDraft | undefined,
  id: string,
  binding: Resources[string] | undefined,
  mode: 'manual' | 'default' = 'manual',
): { resources: Resources; directoryDraft?: DirectoryBindingDraft } {
  const next = { ...resources };
  const manual = new Set(state?.manual ?? []);
  const derived = { ...state?.derived };
  const declaration = declarations.find((resource) => resource.id === id);
  if (mode === 'default') {
    const source = declarations.find(
      (resource) => resource.id === declaration?.defaultDirectoryFrom,
    );
    const path = source && resources[source.id]?.path;
    if (declaration?.kind !== 'directory' || source?.kind !== 'directory' || !path)
      return { resources, directoryDraft: state };
    binding = { path };
    manual.delete(id);
    derived[id] = { source: source.id, path };
  } else if (declaration?.defaultDirectoryFrom) {
    manual.add(id);
    delete derived[id];
  }
  if (binding) next[id] = binding;
  else delete next[id];

  if (declaration?.kind === 'directory') {
    for (const target of declarations) {
      if (target.defaultDirectoryFrom !== id || manual.has(target.id)) continue;
      const previous = derived[target.id];
      const follows = previous?.source === id && resources[target.id]?.path === previous.path;
      // Equality with a source path alone never establishes provenance.
      if (resources[target.id]?.path && !follows) continue;
      if (binding?.path) {
        next[target.id] = { path: binding.path };
        derived[target.id] = { source: id, path: binding.path };
      } else if (follows) {
        delete next[target.id];
        delete derived[target.id];
      }
    }
  }
  return {
    resources: next,
    directoryDraft:
      manual.size || Object.keys(derived).length ? { manual: [...manual], derived } : undefined,
  };
}
