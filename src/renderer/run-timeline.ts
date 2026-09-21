import type { Step } from '../shared/types';
import { presentRun, type RunPresentationInput } from '../shared/run-presentation';

export function runTimeline(detail: RunPresentationInput, now = Date.now()) {
  const nodes = new Map<string, Step>();
  const collect = (steps: Step[]) => {
    for (const step of steps) {
      nodes.set(step.id, step);
      if (step.type === 'condition') collect([...step.then, ...step.else]);
      if (step.type === 'loop') collect(step.body);
    }
  };
  collect(detail.snapshot?.steps ?? []);
  const rows = new Map<
    string,
    { instance: string; nodeId: string; started: boolean; ended: boolean }
  >();
  const events = [...detail.events].sort((a, b) => a.sequence - b.sequence);
  for (const event of events) {
    if (!['node-start', 'node-end', 'debug-pause'].includes(event.type) || !event.nodeInstance)
      continue;
    const nodeId = event.nodeInstance.split('/').at(-1)!;
    if (!nodes.has(nodeId) && !/^[a-zA-Z0-9_-]+$/.test(nodeId)) continue;
    const row = rows.get(event.nodeInstance) ?? {
      instance: event.nodeInstance,
      nodeId,
      started: false,
      ended: false,
    };
    if (event.type === 'node-start') row.started = true;
    if (event.type === 'node-end' && event.data?.completed === true) row.ended = true;
    rows.set(row.instance, row);
  }
  // Unvisited branches stay unexecuted; a successful Run does not prove every
  // node in its snapshot executed. Keep each actual loop instance separate.
  for (const node of nodes.values()) {
    if (![...rows.values()].some((row) => row.nodeId === node.id))
      rows.set(node.id, { instance: node.id, nodeId: node.id, started: false, ended: false });
  }
  const view = presentRun(detail, now);
  const live = view.activity === 'active' && !view.closing && !detail.fault;
  return [...rows.values()].map((row) => {
    const node = nodes.get(row.nodeId);
    const current = row.instance === view.step.instance;
    const label = row.ended
      ? '已完成'
      : live && current && view.step.kind === 'paused'
        ? '下一步'
        : live && current && view.step.kind === 'waiting'
          ? '等待人工'
          : live && row.started
            ? '运行中'
            : row.started
              ? '未完成 · 待核对'
              : '尚未执行';
    return {
      ...row,
      name: typeof node?.name === 'string' && node.name ? node.name : row.nodeId,
      type: node?.type,
      label,
      tone: row.ended
        ? 'success'
        : live && current
          ? 'running'
          : row.started
            ? 'warning'
            : 'neutral',
      current,
    };
  });
}
