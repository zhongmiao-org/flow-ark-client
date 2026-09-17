import type { Step } from '../shared/types';

export type ScriptDependency = { name: string; version: string };
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)';
const exactVersion = new RegExp(
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)' +
    '(?:-' +
    identifier +
    '(?:\\.' +
    identifier +
    ')*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$',
);
export function validateDependency(value: ScriptDependency) {
  if (typeof value.name !== 'string' || value.name.length > 214 || !packageName.test(value.name))
    throw new Error('无效的脚本依赖包名：' + value.name);
  if (
    typeof value.version !== 'string' ||
    value.version.length > 100 ||
    !exactVersion.test(value.version)
  )
    throw new Error('脚本依赖必须声明精确版本：' + value.name);
  return value;
}
// Call with the flattened scope tree. One local binding per package name.
export function declaredDependencies(steps: Step[]): ScriptDependency[] {
  const versions = new Map<string, string>();
  for (const n of steps) {
    if (n.type !== 'script') continue;
    const names = new Set<string>();
    for (const dep of n.dependencies) {
      validateDependency(dep);
      if (names.has(dep.name)) throw new Error('节点依赖重复：' + dep.name);
      names.add(dep.name);
      if (versions.has(dep.name) && versions.get(dep.name) !== dep.version)
        throw new Error('同一流程的依赖版本冲突：' + dep.name);
      versions.set(dep.name, dep.version);
    }
  }
  return [...versions]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => ({ name, version }));
}
