/** Normative declaration semantics, contracts 0.31.0. No path or binding resolution. */
export type DirectoryDefaultDeclaration = {
  id: string;
  kind: string;
  defaultDirectoryFrom?: string;
};
export function assertDirectoryDefaults(resources: readonly DirectoryDefaultDeclaration[]): void {
  const byId = new Map(resources.map(resource => [resource.id, resource]));
  if (byId.size !== resources.length) throw Error('默认目录资源标识重复');
  for (const resource of resources) {
    if (resource.defaultDirectoryFrom === undefined) continue;
    const source = byId.get(resource.defaultDirectoryFrom);
    if (resource.kind !== 'directory' || !source || source.kind !== 'directory')
      throw Error('默认目录必须引用已声明的目录资源：' + resource.id);
    if (source.id === resource.id || source.defaultDirectoryFrom !== undefined)
      throw Error('默认目录不能自引用、循环或链式引用：' + resource.id);
  }
}
