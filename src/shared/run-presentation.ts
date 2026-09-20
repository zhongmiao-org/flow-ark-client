import type { Event, ExecutionObservation, Flow, Json, Run, Step } from './types';

export type RunPresentationInput = {
  run: Run;
  events: Event[];
  snapshot?: Flow;
  execution?: ExecutionObservation;
  fault?: string;
  output?: Json;
};
export type RunStepPresentation = {
  kind: 'current' | 'paused' | 'waiting' | 'last' | 'pending' | 'unknown';
  label: string;
  instance?: string;
  nodeId?: string;
  name?: string;
  type?: string;
};
export type RunElapsedPresentation = {
  kind: 'live' | 'final' | 'recorded' | 'unknown';
  milliseconds: number | null;
  label: string;
  note: string;
};
export type RunPresentation = {
  activity: 'active' | 'inactive' | 'unknown';
  closing: boolean;
  statusNote?: string;
  step: RunStepPresentation;
  elapsed: RunElapsedPresentation;
  progress: {
    kind: 'reported' | 'none';
    label: string;
    instance?: string;
    completed?: number;
    total?: number;
  };
  output: {
    available: boolean;
    full: string;
    preview: string;
    truncated: boolean;
    characters: number;
  };
};

const terminalStates = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const outputPreviewLimit = 8192;

export function formatRunDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '时长不可确定';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分 ${seconds % 60}秒`;
  return `${Math.floor(minutes / 60)}小时 ${minutes % 60}分 ${seconds % 60}秒`;
}

function location(instance: string, snapshot?: Flow) {
  const parts = instance.split('/').map((part) => /^([a-zA-Z0-9_-]+)(?:\[(\d+)\])?$/.exec(part));
  const last = parts.at(-1);
  if (parts.some((part) => !part) || !last || last[2] !== undefined) return {};
  const nodeId = last[1];
  let nodes = snapshot?.steps;
  let node: Step | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    node = nodes?.find((candidate) => candidate.id === part[1]);
    if (!node) return { nodeId };
    if (i === parts.length - 1) break;
    if (node.type === 'loop' && part[2] !== undefined) nodes = node.body;
    else if (node.type === 'condition' && part[2] === undefined)
      nodes = [...node.then, ...node.else];
    else return { nodeId };
  }
  return {
    nodeId,
    name: typeof node?.name === 'string' && node.name ? node.name : node?.id,
    type: node?.type,
  };
}

function presentStep(
  input: RunPresentationInput,
  events: Event[],
  activity: RunPresentation['activity'],
  closing: boolean,
): { step: RunStepPresentation; start?: Event } {
  const open = new Map<string, Event>();
  let lastStep: Event | undefined;
  for (const event of events) {
    if (event.type === 'node-start' && event.nodeInstance) {
      open.set(event.nodeInstance, event);
      lastStep = event;
    } else if (event.type === 'node-end' && event.nodeInstance) {
      open.delete(event.nodeInstance);
      lastStep = event;
    }
  }
  const start = [...open.values()].sort(
    (a, b) =>
      b.nodeInstance.split('/').length - a.nodeInstance.split('/').length ||
      b.sequence - a.sequence,
  )[0];
  const terminal = terminalStates.has(input.run.state);
  let selected: Event | undefined = start ?? lastStep;
  let kind: RunStepPresentation['kind'] = 'last';
  if (activity === 'active' && !terminal && !closing && !input.fault) {
    if (input.run.state === 'PAUSED') {
      const state = events.findLast((event) => event.type === 'state');
      const pause = events.findLast((event) => event.type === 'debug-pause' && event.nodeInstance);
      // A PAUSED write can be observed before its following debug-pause event.
      // Do not reuse the previous pause or a location which has already started.
      selected =
        pause &&
        (!state || (state.data?.state === 'PAUSED' && pause.sequence > state.sequence)) &&
        !events.some((event) => event.type === 'node-start' && event.sequence > pause.sequence)
          ? pause
          : undefined;
      kind = 'paused';
    } else if (start) kind = input.run.state === 'WAITING_INPUT' ? 'waiting' : 'current';
    else return { step: { kind: 'pending', label: '等待下一条步骤记录' } };
  }
  if (!selected) {
    return {
      step: {
        kind: closing ? 'pending' : 'unknown',
        label: closing ? '正在收尾' : '步骤位置不可确定',
      },
    };
  }
  const details = location(selected.nodeInstance, input.snapshot);
  const name =
    details.name ?? (details.nodeId ? `${details.nodeId}（名称未记录）` : '名称不可确定');
  const prefix = {
    current: '当前步骤',
    paused: '下一步',
    waiting: '等待人工',
    last: '最后记录步骤',
  }[kind];
  return {
    step: {
      kind,
      label: `${prefix}：${name}`,
      instance: selected.nodeInstance,
      ...details,
      type:
        details.type ?? (typeof selected.data?.type === 'string' ? selected.data.type : undefined),
    },
    start: selected === start && (kind === 'current' || kind === 'waiting') ? start : undefined,
  };
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function presentElapsed(
  input: RunPresentationInput,
  events: Event[],
  activity: RunPresentation['activity'],
  nowMs: number,
): RunElapsedPresentation {
  const unknown = (note: string): RunElapsedPresentation => ({
    kind: 'unknown',
    milliseconds: null,
    label: '时长不可确定',
    note,
  });
  const startIndex = events.findIndex(
    (event) => event.type === 'state' && event.data?.state === 'RUNNING',
  );
  if (startIndex < 0) return unknown('没有已保存的运行开始时间；排队时间不计入运行总耗时。');
  const start = timestamp(events[startIndex].time);
  if (start === undefined) return unknown('运行开始时间缺失或无效。');
  const terminal = terminalStates.has(input.run.state);
  const finishIndex = terminal
    ? events.findLastIndex(
        (event) => event.type === 'state' && event.data?.state === input.run.state,
      )
    : -1;
  const recovered = finishIndex >= 0 && events[finishIndex].data?.reason === 'host-restarted';
  const kind: RunElapsedPresentation['kind'] =
    terminal && finishIndex >= 0 && !recovered
      ? 'final'
      : !terminal && activity === 'active'
        ? 'live'
        : 'recorded';
  const endIndex = recovered ? finishIndex - 1 : finishIndex >= 0 ? finishIndex : events.length - 1;
  if (endIndex < startIndex) return unknown('没有可确认的结束时间；实际运行时长待核对。');
  let last = start;
  for (const event of events.slice(startIndex, endIndex + 1)) {
    const time = timestamp(event.time);
    if (time === undefined || time < last)
      return unknown('记录时间缺失或倒退，不能据此计算运行时长。');
    last = time;
  }
  const end = kind === 'live' ? nowMs : last;
  if (!Number.isFinite(end) || end < last)
    return unknown('当前时间早于运行记录，不能据此计算运行时长。');
  return {
    kind,
    milliseconds: end - start,
    label: formatRunDuration(end - start),
    note:
      kind === 'recorded'
        ? '已记录时长；实际结束时间和最终结果待核对，重启时间不计作执行结束时间。'
        : '运行总耗时，包含暂停和人工等待，不含排队时间。',
  };
}

function presentProgress(events: Event[], start?: Event): RunPresentation['progress'] {
  if (start) {
    const report = events.findLast((event) => {
      if (
        event.type !== 'progress' ||
        event.nodeInstance !== start.nodeInstance ||
        event.sequence <= start.sequence
      )
        return false;
      const { completed, total } = event.data ?? {};
      return (
        typeof completed === 'number' &&
        Number.isFinite(completed) &&
        completed >= 0 &&
        (total === undefined ||
          (typeof total === 'number' && Number.isFinite(total) && total >= completed))
      );
    });
    if (report) {
      const { completed, total } = report.data as { completed: number; total?: number };
      return {
        kind: 'reported',
        label: total === undefined ? `已处理 ${completed}` : `脚本报告 ${completed} / ${total}`,
        instance: start.nodeInstance,
        completed,
        ...(total === undefined ? {} : { total }),
      };
    }
  }
  return { kind: 'none', label: '未报告数量' };
}

function presentOutput(output: Json | undefined): RunPresentation['output'] {
  if (output === undefined)
    return { available: false, full: '', preview: '', truncated: false, characters: 0 };
  const full = JSON.stringify(output, null, 2);
  return {
    available: true,
    full,
    preview: full.slice(0, outputPreviewLimit),
    truncated: full.length > outputPreviewLimit,
    characters: full.length,
  };
}

export function presentRun(input: RunPresentationInput, nowMs: number): RunPresentation {
  const events = input.events
    .filter((event) => event.runId === input.run.id)
    .sort((a, b) => a.sequence - b.sequence);
  const activity = !input.execution
    ? 'unknown'
    : input.execution.active?.runId === input.run.id
      ? 'active'
      : 'inactive';
  const closing = activity === 'active' && input.execution?.active?.phase === 'closing';
  const { step, start } = presentStep(input, events, activity, closing);
  const statusNote = input.fault
    ? '已停止接收新任务；状态为最后成功保存的记录，当前执行和最终结果请核对。'
    : closing
      ? '正在收尾。'
      : !terminalStates.has(input.run.state) && activity === 'inactive'
        ? '最后保存状态；宿主当前未持有此运行，执行结果待核对。'
        : activity === 'unknown'
          ? '缺少宿主执行观察，实时状态未知。'
          : undefined;
  return {
    activity,
    closing,
    statusNote,
    step,
    elapsed: presentElapsed(input, events, activity, nowMs),
    progress: presentProgress(events, start),
    output: presentOutput(input.output),
  };
}
