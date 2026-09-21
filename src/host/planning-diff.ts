import type { Flow, Step } from '../shared/types';
import type { PlanningChange } from '../shared/planning';
import { canonical } from '../shared/utils';

function nodes(flow: Flow | null) {
  const result = new Map<string, { node: Record<string, unknown>; position: string }>();
  const visit = (steps: Step[], parent: string) =>
    steps.forEach((step, i) => {
      const { then: yes, else: no, body, ...node } = step as any;
      result.set(step.id, { node, position: parent + '/' + i });
      if (step.type === 'condition') {
        visit(yes, step.id + '/then');
        visit(no, step.id + '/else');
      }
      if (step.type === 'loop') visit(body, step.id + '/body');
    });
  visit(flow?.steps ?? [], 'steps');
  return result;
}
export function planningDiff(before: Flow | null, after: Flow): PlanningChange[] {
  const changes: PlanningChange[] = [];
  for (const field of [
    'name',
    'description',
    'parameters',
    'requiredCapabilities',
    'sourceTemplate',
  ] as const) {
    const a = before?.[field] ?? null,
      b = after[field] ?? null;
    if (canonical(a) !== canonical(b))
      changes.push({ kind: 'changed', path: field, label: field, before: a, after: b });
  }
  const a = nodes(before),
    b = nodes(after);
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id),
      next = b.get(id);
    const label = String(next?.node.name ?? old?.node.name ?? id);
    if (!old || !next) {
      changes.push({
        nodeId: id,
        kind: old ? 'removed' : 'added',
        path: 'steps/' + id,
        label,
        before: old ?? null,
        after: next ?? null,
      });
      continue;
    }
    if (old.position !== next.position)
      changes.push({
        nodeId: id,
        kind: 'moved',
        path: 'steps/' + id,
        label,
        before: old.position,
        after: next.position,
      });
    for (const key of new Set([...Object.keys(old.node), ...Object.keys(next.node)])) {
      const x = old.node[key] ?? null,
        y = next.node[key] ?? null;
      if (canonical(x) !== canonical(y))
        changes.push({
          nodeId: id,
          kind: 'changed',
          path: 'steps/' + id + '/' + key,
          label,
          before: x,
          after: y,
        });
    }
  }
  return changes;
}
export function planningResources(flow: Flow): string[] {
  return [
    ...new Set(
      [...nodes(flow).values()].flatMap(({ node: n }) => {
        if (n.type === 'file' && n.operation === 'create')
          return [`文件 · ${n.binding} · 新建文本，同名停止，不覆盖`];
        if (n.type === 'file' || n.type === 'excel')
          return [`${n.type} · ${n.binding} · ${n.operation}`];
        if (n.type === 'browser') return [`网页 · ${n.operation}`];
        if (n.type === 'http')
          return [`HTTP · ${n.method} · ${typeof n.url === 'string' ? n.url : '动态地址'}`];
        if (n.type === 'script')
          return [`可信脚本 · ${n.language} · 依赖 ${canonical(n.dependencies)}`];
        return [];
      }),
    ),
  ];
}
