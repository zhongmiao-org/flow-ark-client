import type { Flow, FlowRecord, Json, Step } from '../shared/types';
import { resolveValue } from '../core/engine';
import { changeSteps, flatten } from './flow-editing';

export type ScriptNode = Extract<Step, { type: 'script' }>;
export function scriptInputPreview(input: Json, parameters: Flow['parameters']) {
  try {
    return { value: resolveValue(input, { params: parameters }), available: true as const };
  } catch (error) {
    return { available: false as const, reason: (error as Error).message };
  }
}

/** Edit the isolated draft; package bindings shared by other nodes are retained. */
export function editScriptPackage(
  record: FlowRecord,
  node: ScriptNode,
  name: string,
  info?: { name: string; version: string; path: string },
): FlowRecord {
  const others = flatten(record.flow.steps).filter(
    (step): step is ScriptNode => step.type === 'script' && step.id !== node.id,
  );
  if (
    info &&
    others.some((step) =>
      step.dependencies.some(
        (dependency) => dependency.name === name && dependency.version !== info.version,
      ),
    )
  )
    throw new Error('其他步骤声明了不同版本，请先统一依赖版本：' + name);
  const dependencies = node.dependencies.filter((dependency) => dependency.name !== name);
  if (info) dependencies.push({ name, version: info.version });
  const scriptPackages = { ...record.bindings.scriptPackages };
  if (info) scriptPackages[name] = { path: info.path, version: info.version };
  else if (!others.some((step) => step.dependencies.some((dependency) => dependency.name === name)))
    delete scriptPackages[name];
  return {
    ...record,
    flow: {
      ...record.flow,
      steps: changeSteps(record.flow.steps, node.id, () => ({ ...node, dependencies })),
    },
    bindings: { ...record.bindings, scriptPackages },
  };
}

/** Read only actual stored outputs. Absent branches and iterations stay absent. */
export function scriptOutputs(steps: Step[], output: unknown, selected: string) {
  const results: { instance: string; value: unknown }[] = [];
  function block(nodes: Step[], values: any, prefix: string) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return;
    for (const node of nodes) {
      if (!Object.hasOwn(values, node.id)) continue;
      const value = values[node.id],
        instance = prefix + node.id;
      if (node.id === selected && node.type === 'script') results.push({ instance, value });
      if (node.type === 'condition') block([...node.then, ...node.else], value, instance + '/');
      if (node.type === 'loop' && Array.isArray(value))
        value.forEach((entry, index) => block(node.body, entry, instance + `[${index}]/`));
    }
  }
  block(steps, output, '');
  return results;
}
