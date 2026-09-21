import type { RunPresentationInput } from '../shared/run-presentation';
import { presentRun } from '../shared/run-presentation';
import { runTimeline } from './run-timeline';
import { kinds } from './node-kinds';
import { flatten } from './flow-editing';

export type TaskRunView = 'overview' | 'details' | 'rerun';
export type TaskRunIntent = 'plan' | 'modify' | 'home';
export type RunArtifact = {
  artifactId: string;
  name: string;
  size: number;
  path: string;
  runId: string;
  available: boolean;
  integrity: string;
  storage?: string;
};
export const artifactLabel = (a: RunArtifact) =>
  ({
    verified: '已保存并核对副本',
    changed: '副本内容已改动',
    missing: '副本无法访问',
    cleared: '副本已清理',
    unverified: '旧记录，无法核对历史内容',
  })[a.integrity] ?? '副本状态待核对';

export function taskRunPresentation(
  input: RunPresentationInput & { artifacts?: RunArtifact[] },
  now = Date.now(),
) {
  const detail = { ...input, events: input.events.filter((e) => e.runId === input.run.id) };
  const view = presentRun(detail, now);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(input.run.state);
  const uncertain =
    !!input.fault || (!terminal && input.run.state !== 'QUEUED' && view.activity !== 'active');
  const rows = runTimeline(detail, now).map((row) => ({
    ...row,
    name: row.name === row.nodeId && row.type ? (kinds[row.type]?.label ?? row.name) : row.name,
  }));
  const completed = rows.filter((row) => row.ended);
  const unresolved = rows.filter((row) => row.started && !row.ended);
  const unvisited = rows.filter((row) => !row.started && !row.ended);
  const current = rows.find((row) => row.instance === view.step.instance);
  const success = input.run.state === 'SUCCEEDED' && !uncertain && !view.closing;
  const mode = uncertain
    ? 'unknown'
    : view.closing
      ? 'closing'
      : success
        ? 'success'
        : terminal
          ? 'stopped'
          : 'active';
  const title = {
    unknown: '执行结果需要核对',
    closing: '正在完成运行收尾',
    success: '本次试运行已完成',
    stopped:
      input.run.state === 'FAILED'
        ? current
          ? `停在：${current.name}`
          : '本次试运行未完成'
        : input.run.state === 'CANCELLED'
          ? '本次试运行已取消'
          : '本次试运行已中断',
    active:
      input.run.state === 'QUEUED'
        ? '正在等待运行'
        : input.run.state === 'PAUSED'
          ? '试运行已暂停'
          : input.run.state === 'WAITING_INPUT'
            ? '试运行需要你处理'
            : '正在试运行',
  }[mode];
  const artifacts = (input.artifacts ?? []).filter((a) => a.runId === input.run.id);
  const verified = artifacts.filter((a) => a.available && a.integrity === 'verified');
  const operations = rows.filter(
    (row) => row.started && ['browser', 'file', 'excel', 'http', 'script'].includes(row.type ?? ''),
  );
  const nodes = new Map(flatten(input.snapshot?.steps ?? []).map((n) => [n.id, n]));
  const labels = new Map<string, number>();
  for (const row of operations) {
    const node = nodes.get(row.nodeId);
    const label = !node
      ? '外部步骤'
      : node.type === 'file' || node.type === 'excel'
        ? node.operation === 'read'
          ? '读取文件'
          : '写入文件'
        : node.type === 'http'
          ? '网络请求'
          : node.type === 'script'
            ? '执行脚本'
            : node.type === 'browser'
              ? ['read', 'inputValue', 'wait'].includes(node.operation)
                ? '读取网页'
                : node.operation === 'navigate'
                  ? '打开网页'
                  : '操作网页'
              : '外部步骤';
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const effectNote = labels.size
    ? '已开始：' +
      [...labels].map(([label, count]) => `${label} ${count} 次`).join('、') +
      '。' +
      (labels.has('写入文件') ? '文件副本不表示原位置没有覆盖。' : '') +
      (labels.has('网络请求') || labels.has('操作网页') ? '外部结果需结合业务回执核对。' : '') +
      (labels.has('执行脚本') ? '脚本可能还有未报告的操作。' : '')
    : uncertain
      ? '当前记录不足以核对外部影响。'
      : '未记录文件、网页、网络或脚本步骤的执行。';
  return {
    view,
    mode,
    title,
    terminal,
    uncertain,
    success,
    rows,
    completed,
    unresolved,
    unvisited,
    current,
    node: current ? nodes.get(current.nodeId) : undefined,
    artifacts,
    verified,
    operations,
    summary: artifacts.length
      ? `已登记 ${artifacts.length} 个文件产物，${verified.length} 个副本已核对`
      : `已记录 ${completed.length} 次完成的步骤`,
    effectNote,
  };
}
