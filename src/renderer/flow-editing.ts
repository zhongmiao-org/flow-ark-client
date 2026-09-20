import type { Step } from '../shared/types';
import { nodeReferenceValues, referenceIssues } from '../shared/flow-references';
export type Branch = 'then' | 'else' | 'body';
export type Destination = {
  owner?: string;
  branch?: Branch;
  anchor?: string;
  side?: 'before' | 'after';
};
export function flatten(steps: Step[]): Step[] {
  return steps.flatMap((n) => [
    n,
    ...(n.type === 'condition'
      ? [...flatten(n.then), ...flatten(n.else)]
      : n.type === 'loop'
        ? flatten(n.body)
        : []),
  ]);
}
export function changeSteps(steps: Step[], id: string, fn: (node: Step) => Step | null): Step[] {
  return steps.flatMap((n) => {
    if (n.id === id) {
      const changed = fn(n);
      return changed ? [changed] : [];
    }
    return [
      n.type === 'condition'
        ? { ...n, then: changeSteps(n.then, id, fn), else: changeSteps(n.else, id, fn) }
        : n.type === 'loop'
          ? { ...n, body: changeSteps(n.body, id, fn) }
          : n,
    ];
  });
}
export function locationOf(
  steps: Step[],
  id: string,
): { siblings: Step[]; index: number } | undefined {
  const index = steps.findIndex((n) => n.id === id);
  if (index >= 0) return { siblings: steps, index };
  for (const n of steps) {
    const found =
      n.type === 'condition'
        ? (locationOf(n.then, id) ?? locationOf(n.else, id))
        : n.type === 'loop'
          ? locationOf(n.body, id)
          : undefined;
    if (found) return found;
  }
}
function editBlock(steps: Step[], target: Step[], edit: (siblings: Step[]) => Step[]): Step[] {
  if (steps === target) return edit(steps);
  return steps.map((n) =>
    n.type === 'condition'
      ? { ...n, then: editBlock(n.then, target, edit), else: editBlock(n.else, target, edit) }
      : n.type === 'loop'
        ? { ...n, body: editBlock(n.body, target, edit) }
        : n,
  );
}
export function insertStep(steps: Step[], node: Step, destination: Destination): Step[] {
  if (destination.anchor) {
    const location = locationOf(steps, destination.anchor);
    if (!location) throw new Error('插入位置已删除，请重新选择');
    return editBlock(steps, location.siblings, (list) =>
      list.toSpliced(location.index + (destination.side === 'after' ? 1 : 0), 0, node),
    );
  }
  if (!destination.owner) return [...steps, node];
  const parent = flatten(steps).find((n) => n.id === destination.owner);
  const valid =
    parent?.type === 'condition'
      ? ['then', 'else'].includes(destination.branch ?? '')
      : parent?.type === 'loop' && destination.branch === 'body';
  if (!valid) throw new Error('添加位置已删除，请重新选择');
  return changeSteps(steps, parent!.id, (old) => ({
    ...old,
    [destination.branch!]: [...(old as any)[destination.branch!], node],
  }));
}
export function moveStep(steps: Step[], id: string, destination: Destination): Step[] {
  const node = flatten(steps).find((n) => n.id === id);
  if (!node) throw new Error('待移动步骤已删除');
  const descendants = new Set(flatten([node]).map((n) => n.id));
  if (descendants.has(destination.anchor ?? '') || descendants.has(destination.owner ?? ''))
    throw new Error('不能移动到自身或子步骤中');
  return insertStep(
    changeSteps(steps, id, () => null),
    node,
    destination,
  );
}
export function moveSibling(steps: Step[], id: string, direction: -1 | 1): Step[] {
  const found = locationOf(steps, id);
  if (!found || !found.siblings[found.index + direction]) return steps;
  return editBlock(steps, found.siblings, (list) => {
    const next = [...list];
    [next[found.index], next[found.index + direction]] = [
      next[found.index + direction],
      next[found.index],
    ];
    return next;
  });
}
export function duplicateStep(
  steps: Step[],
  id: string,
  makeId = () => 'n_' + crypto.randomUUID().replaceAll('-', ''),
): { steps: Step[]; id: string } {
  const original = flatten(steps).find((n) => n.id === id);
  if (!original) throw new Error('待复制步骤已删除');
  const used = new Set(flatten(steps).map((n) => n.id)),
    ids = new Map<string, string>();
  for (const node of flatten([original])) {
    let next = makeId(),
      attempts = 0;
    while (used.has(next)) {
      if (++attempts > 100) throw new Error('无法生成独立节点 ID');
      next = makeId();
    }
    used.add(next);
    ids.set(node.id, next);
  }
  const refs = (value: any): any => {
    if (Array.isArray(value)) return value.map(refs);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') {
      const [root, step, ...tail] = value.$ref.split('.');
      if (root === 'steps' && ids.has(step)) {
        // Condition outputs are keyed by child IDs; loop outputs add an array index.
        // Rewrite only those structural keys, never arbitrary output-object properties.
        let source = flatten([original]).find((node) => node.id === step),
          index = 0;
        while (source && index < tail.length) {
          if (source.type === 'loop') {
            if (!/^\d+$/.test(tail[index])) break;
            index++;
          }
          const children: Step[] =
            source.type === 'condition'
              ? [...source.then, ...source.else]
              : source.type === 'loop'
                ? source.body
                : [];
          const child = children.find((node) => node.id === tail[index]);
          if (!child) break;
          tail[index] = ids.get(child.id)!;
          source = child;
          index++;
        }
        return { $ref: [root, ids.get(step), ...tail].join('.') };
      }
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, refs(v)]));
  };
  const cloned = refs(original) as Step;
  for (const node of flatten([cloned])) node.id = ids.get(node.id)!;
  if (original.name) cloned.name = original.name + ' 副本';
  return { steps: insertStep(steps, cloned, { anchor: id, side: 'after' }), id: cloned.id };
}
// Outputs from conditions and loops contain child IDs. Moving a child can leave
// the first reference segment valid while breaking a later structural segment.
function outputReferenceIssues(steps: Step[]) {
  const nodes = flatten(steps),
    byId = new Map(nodes.map((node) => [node.id, node]));
  const issues: string[] = [];
  function values(value: any, owner: string) {
    if (!value || typeof value !== 'object') return;
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') {
      const [root, id, ...tail] = value.$ref.split('.');
      if (root !== 'steps') return;
      let source = byId.get(id),
        index = 0;
      while (source && index < tail.length) {
        if (source.type === 'loop') {
          if (!/^\d+$/.test(tail[index])) break;
          index++;
          if (index === tail.length) break;
        }
        if (source.type !== 'condition' && source.type !== 'loop') break;
        const children =
          source.type === 'condition' ? [...source.then, ...source.else] : source.body;
        const child = children.find((node) => node.id === tail[index]);
        if (!child) {
          issues.push(`${owner} 的 ${value.$ref} 引用的子步骤已不在该输出中`);
          break;
        }
        source = child;
        index++;
      }
      return;
    }
    for (const child of Object.values(value)) values(child, owner);
  }
  for (const node of nodes) {
    values(nodeReferenceValues(node), node.id);
  }
  return issues;
}
export function checkStructure(before: Step[], after: Step[], parameters: Record<string, unknown>) {
  const existing = new Set(
    referenceIssues(before, parameters).map((issue) => JSON.stringify(issue)),
  );
  const added = referenceIssues(after, parameters).find(
    (issue) => !existing.has(JSON.stringify(issue)),
  );
  if (added)
    throw new Error(
      `无法调整：${added.nodeId} 的 ${added.reference} ${added.message}。请先调整引用。`,
    );
  const previousOutputs = new Set(outputReferenceIssues(before));
  const missingOutput = outputReferenceIssues(after).find((issue) => !previousOutputs.has(issue));
  if (missingOutput) throw new Error(`无法调整：${missingOutput}。请先调整引用。`);
  let count = 0;
  function depth(nodes: Step[], level: number) {
    if (level > 16) throw new Error('流程嵌套超过 16 层');
    for (const node of nodes) {
      if (++count > 1000) throw new Error('流程最多包含 1000 个步骤');
      if (node.type === 'condition') {
        depth(node.then, level + 1);
        depth(node.else, level + 1);
      }
      if (node.type === 'loop') depth(node.body, level + 1);
    }
  }
  depth(after, 0);
}
