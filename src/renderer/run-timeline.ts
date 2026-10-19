import type { Step } from '../shared/types';
import { presentRun, type RunPresentationInput } from './run-presentation';
import { taskStepTitle } from './task-step-presentation';
import { runInstancePresenter } from './run-instance-presentation';

export function runTimeline(detail: RunPresentationInput, now = Date.now()) {
  const nodes = new Map<string, Step>();
  const ordinals = new Map<string, number>();
  const collect = (steps: Step[]) => {
    for (const step of steps) {
      nodes.set(step.id, step);
      ordinals.set(step.id, ordinals.size + 1);
      if (step.type === 'condition') collect([...step.then, ...step.else]);
      if (step.type === 'loop') collect(step.body);
    }
  };
  collect(detail.snapshot?.steps ?? []);
  const describeInstance = runInstancePresenter(detail.snapshot);
  const rows = new Map<
    string | symbol,
    {
      instance: string;
      nodeId: string;
      located: boolean;
      recorded: boolean;
      started: boolean;
      ended: boolean;
    }
  >();
  const events = detail.events
    .filter((event) => event.runId === detail.run.id)
    .sort((a, b) => a.sequence - b.sequence);
  for (const event of events) {
    if (!['node-start', 'node-end', 'debug-pause'].includes(event.type) || !event.nodeInstance)
      continue;
    const nodeId = event.nodeInstance.split('/').at(-1)!;
    const row = rows.get(event.nodeInstance) ?? {
      instance: event.nodeInstance,
      nodeId,
      located: describeInstance(event.nodeInstance) !== null,
      recorded: true,
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
    if (![...rows.values()].some((row) => row.located && row.nodeId === node.id))
      rows.set(Symbol(node.id), {
        instance: node.id,
        nodeId: node.id,
        located: true,
        recorded: false,
        started: false,
        ended: false,
      });
  }
  const view = presentRun(detail, now);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(detail.run.state);
  const live = !terminal && view.activity === 'active' && !view.closing && !detail.fault;
  return [...rows.values()].map((row) => {
    const node = row.located ? nodes.get(row.nodeId) : undefined;
    const current = row.recorded && row.instance === view.step.instance;
    const label = !node
      ? row.ended
        ? '记录完成 · 位置待核对'
        : row.started
          ? '未完成 · 位置待核对'
          : '位置待核对'
      : row.ended
        ? '已完成'
        : live && current && view.step.kind === 'paused'
          ? '下一步'
          : live && current && view.step.kind === 'waiting'
            ? '等待人工'
            : live && row.started
              ? detail.run.state === 'PAUSED'
                ? '已暂停 · 未完成'
                : '运行中'
              : row.started
                ? '未完成 · 待核对'
                : '尚未执行';
    return {
      ...row,
      key: row.located ? row.instance : `unresolved:${row.instance}`,
      name: node ? taskStepTitle(node) : '步骤位置待核对',
      ordinal: node ? (ordinals.get(row.nodeId) ?? null) : null,
      pathLabel: node ? describeInstance(row.instance) : null,
      type: node?.type,
      label,
      tone: !node
        ? 'warning'
        : row.ended
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

export function runTimelineTitle(step: ReturnType<typeof runTimeline>[number]) {
  return `${step.ordinal === null ? '' : String(step.ordinal).padStart(2, '0') + ' '}${step.name}`;
}
